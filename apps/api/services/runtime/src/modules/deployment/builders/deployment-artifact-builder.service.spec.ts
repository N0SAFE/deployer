import { mkdtempSync } from "node:fs";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { DeploymentProviderBuilderRunnerStateMachineService } from "@deployer/shared/core/modules/deployment/services/deployment-provider-builder-runner-state-machine.service";

import { RuntimeInvalid } from "../../../core/runtime.errors";

import { makeBuilderRegistry } from "./builder-registry.service";
import { makeDeploymentArtifactBuilder, type BuildArtifactInput } from "./deployment-artifact-builder.service";
import { makeBuildpackFamilyBuilderStrategy } from "./strategies/buildpack-family-builder.strategy";
import { makeDockerComposeBuilderStrategy } from "./strategies/docker-compose-builder.strategy";
import { makeDockerfileBuilderStrategy } from "./strategies/dockerfile-builder.strategy";


/**
 * The builder registry the real module wires, assembled here with the same shape.
 *
 * Built from the real strategy classes rather than mocks so these tests exercise the
 * actual dispatch — including the fact that the three buildpack-family builders are
 * registered but UNAVAILABLE, which is the behaviour that replaces the old
 * "Dockerfile not found" failure.
 */
/**
 * The strategies reach Docker through `getEngine().build`; the specs keep their `buildImage` /
 * `buildCompose` mocks (so the assertions read as before) and expose them as the engine's Effects.
 */
const withEngine = <T extends { buildImage: unknown; buildCompose?: unknown }>(mocks: T): T =>
    Object.assign(mocks, ({
            build: {
                image: (...args: unknown[]) => Effect.promise(async () => (mocks.buildImage as (...a: unknown[]) => unknown)(...args)),
                compose: (...args: unknown[]) => Effect.promise(async () => (mocks.buildCompose as (...a: unknown[]) => unknown)(...args)),
            },
        }));

const createRegistry = (dockerService: { buildImage: ReturnType<typeof vi.fn>; buildCompose?: ReturnType<typeof vi.fn> }) =>
    makeBuilderRegistry([
        // `as never` at the boundary only: the strategies take the real `DockerService`,
        // and this spec supplies the two methods it actually calls. A narrower
        // constructor type would weaken the production contract to suit a test.
        makeDockerfileBuilderStrategy(dockerService as never),
        makeDockerComposeBuilderStrategy(dockerService as never),
        makeBuildpackFamilyBuilderStrategy("nixpacks", dockerService as never),
        makeBuildpackFamilyBuilderStrategy("buildpack", dockerService as never),
        makeBuildpackFamilyBuilderStrategy("railpack", dockerService as never),
    ]);

const createService = (
    rawDockerService: { buildImage: ReturnType<typeof vi.fn>; buildCompose?: ReturnType<typeof vi.fn> },
    gitServiceOverrides?: Partial<{ extractUploadedFile: ReturnType<typeof vi.fn> }>,
) => {
    const dockerService = withEngine(rawDockerService);
    const builder = makeDeploymentArtifactBuilder({
        gitService: {
            extractUploadedFile: vi.fn(),
            ...(gitServiceOverrides ?? {}),
        } as never,
        stateMachine: DeploymentProviderBuilderRunnerStateMachineService.live,
        // See `createRegistry`: the spec supplies only the two Docker methods under
        // test, so the widening stays at this boundary.
        builderRegistry: createRegistry(dockerService),
    });
    return {
        buildContainerizedArtifact: (input: BuildArtifactInput) => Effect.runPromise(builder.buildContainerizedArtifact(input)),
        failure: (input: BuildArtifactInput) => Effect.runPromise(Effect.flip(builder.buildContainerizedArtifact(input))),
    };
};

describe("DeploymentArtifactBuilder", () => {
    it("uses external builder only with explicit container image", async () => {
        const service = createService({ buildImage: vi.fn() });

        const failure = await service.failure({
                deploymentId: "dep-1",
                serviceId: "svc-1",
                builder: "external",
                sourceCheckout: null,
                fallbackContainerImage: null,
            });
        expect(failure).toBeInstanceOf(RuntimeInvalid);
        expect(failure).toMatchObject({ reason: expect.stringContaining("requires an explicit prebuilt container image") });
    });

    it("returns provided image for external builder", async () => {
        const dockerService = { buildImage: vi.fn() };
        const service = createService(dockerService);

        const result = await service.buildContainerizedArtifact({
            deploymentId: "dep-1",
            serviceId: "svc-1",
            builder: "external",
            sourceCheckout: null,
            fallbackContainerImage: "ghcr.io/acme/web:1",
        });

        expect(result).toBe("ghcr.io/acme/web:1");
        expect(dockerService.buildImage).not.toHaveBeenCalled();
    });

    it("builds with generated custom Dockerfile when custom commands are provided", async () => {
        const dockerService = { buildImage: vi.fn().mockResolvedValue(undefined) };
        const service = createService(dockerService);
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-builder-custom-"));

        const image = await service.buildContainerizedArtifact({
            deploymentId: "dep-2",
            serviceId: "svc-2",
            builder: "nixpacks",
            sourceCheckout: {
                provider: "upload",
                uploadId: "upload-2",
                uploadPath: uploadDir,
            },
            fallbackContainerImage: null,
            customCommands: {
                cli: {
                    bun: true,
                },
                buildCommand: "bun install && bun run build",
                runCommand: "bun run start",
            },
        });

        expect(image).toContain("deployer/");
        expect(dockerService.buildImage).toHaveBeenCalledWith(
            uploadDir,
            expect.stringContaining("deployer/"),
            expect.objectContaining({
                dockerfileName: "Dockerfile.deployer.custom",
            }),
        );
    });

    it("rejects custom command when referenced CLI is disabled", async () => {
        const service = createService({ buildImage: vi.fn() });
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-builder-policy-"));

        const failure = await service.failure({
                deploymentId: "dep-3",
                serviceId: "svc-3",
                builder: "buildpack",
                sourceCheckout: {
                    provider: "upload",
                    uploadId: "upload-3",
                    uploadPath: uploadDir,
                },
                fallbackContainerImage: null,
                customCommands: {
                    cli: { bun: false },
                    buildCommand: "bun run build",
                },
            });
        expect(failure).toBeInstanceOf(RuntimeInvalid);
        expect(failure).toMatchObject({ reason: expect.stringContaining("execution.customCommands.cli.bun is disabled") });
    });

    it("allows command-driven custom builder mode when builder is omitted", async () => {
        const dockerService = { buildImage: vi.fn().mockResolvedValue(undefined) };
        const service = createService(dockerService);
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-builder-managed-"));

        const image = await service.buildContainerizedArtifact({
            deploymentId: "dep-4",
            serviceId: "svc-4",
            builder: null,
            sourceCheckout: {
                provider: "upload",
                uploadId: "upload-4",
                uploadPath: uploadDir,
            },
            fallbackContainerImage: null,
            customCommands: {
                cli: {
                    node: true,
                    npm: true,
                },
                buildCommand: "npm ci && npm run build",
                runCommand: "node dist/server.js",
            },
        });

        expect(image).toContain("deployer/");
        expect(dockerService.buildImage).toHaveBeenCalledWith(
            uploadDir,
            expect.stringContaining("deployer/"),
            expect.objectContaining({
                dockerfileName: "Dockerfile.deployer.custom",
            }),
        );
    });

    it("rejects custom commands for user-managed dockerfile builder", async () => {
        const service = createService({ buildImage: vi.fn() });
        const uploadDir = mkdtempSync(path.join("/tmp", "deployer-builder-user-dockerfile-"));

        const failure = await service.failure({
                deploymentId: "dep-5",
                serviceId: "svc-5",
                builder: "dockerfile",
                sourceCheckout: {
                    provider: "upload",
                    uploadId: "upload-5",
                    uploadPath: uploadDir,
                },
                fallbackContainerImage: null,
                customCommands: {
                    cli: { node: true },
                    runCommand: "node server.js",
                },
            });
        expect(failure).toBeInstanceOf(RuntimeInvalid);
        expect(failure).toMatchObject({ reason: expect.stringContaining("Custom build/run commands are allowed only for platform-managed builders") });
    });

    it("rejects custom commands for external builder", async () => {
        const service = createService({ buildImage: vi.fn() });

        const failure = await service.failure({
                deploymentId: "dep-6",
                serviceId: "svc-6",
                builder: "external",
                sourceCheckout: null,
                fallbackContainerImage: "ghcr.io/acme/prebuilt:latest",
                customCommands: {
                    cli: { node: true },
                    runCommand: "node server.js",
                },
            });
        expect(failure).toBeInstanceOf(RuntimeInvalid);
        expect(failure).toMatchObject({ reason: expect.stringContaining("Custom build/run commands are allowed only for platform-managed builders") });
    });

    it("extracts uploaded ZIP file and builds dockerfile image from extracted context", async () => {
        const dockerService = { buildImage: vi.fn().mockResolvedValue(undefined) };
        const extractedDir = mkdtempSync(path.join("/tmp", "deployer-builder-extracted-"));
        writeFileSync(path.join(extractedDir, "Dockerfile"), "FROM nginx:alpine\n", "utf8");

        const extractUploadedFile = vi.fn().mockResolvedValue(extractedDir);
        const service = createService(dockerService, { extractUploadedFile });

        const archivePath = path.join(mkdtempSync(path.join("/tmp", "deployer-builder-archive-")), "bundle.zip");
        writeFileSync(archivePath, "fake-archive-content", "utf8");

        const image = await service.buildContainerizedArtifact({
            deploymentId: "dep-zip-1",
            serviceId: "svc-zip-1",
            builder: "dockerfile",
            sourceCheckout: {
                provider: "upload",
                uploadId: "upload-zip-1",
                uploadPath: archivePath,
            },
            fallbackContainerImage: null,
        });

        expect(extractUploadedFile).toHaveBeenCalledWith({
            filePath: archivePath,
            deploymentId: "dep-zip-1",
        });
        expect(dockerService.buildImage).toHaveBeenCalledWith(
            extractedDir,
            expect.stringContaining("deployer/"),
            {},
        );
        expect(image).toContain("deployer/");
    });

    it("fails dockerfile builder when extracted ZIP context has no Dockerfile", async () => {
        const dockerService = { buildImage: vi.fn().mockResolvedValue(undefined) };
        const extractedDir = mkdtempSync(path.join("/tmp", "deployer-builder-no-dockerfile-"));
        const extractUploadedFile = vi.fn().mockResolvedValue(extractedDir);
        const service = createService(dockerService, { extractUploadedFile });

        const archivePath = path.join(mkdtempSync(path.join("/tmp", "deployer-builder-archive-")), "bundle.zip");
        writeFileSync(archivePath, "fake-archive-content", "utf8");

        const failure = await service.failure({
                deploymentId: "dep-zip-2",
                serviceId: "svc-zip-2",
                builder: "dockerfile",
                sourceCheckout: {
                    provider: "upload",
                    uploadId: "upload-zip-2",
                    uploadPath: archivePath,
                },
                fallbackContainerImage: null,
            });
        expect(failure).toBeInstanceOf(RuntimeInvalid);
        expect(failure).toMatchObject({ reason: expect.stringContaining("Builder 'dockerfile' requires a Dockerfile in the source context") });

        expect(dockerService.buildImage).not.toHaveBeenCalled();
    });
});
