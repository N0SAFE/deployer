import { existsSync } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { Context, Effect } from "effect";

import type { DeploymentSourceCheckoutContext } from "@deployer/contracts-entities";
import type { DockerError } from "@deployer/docker";
import { serviceOver } from "@deployer/effect-core";
import { beginHeavyWork } from "@deployer/shared/core/utils/heavy-work.registry";

import { attempt } from "../../../core/effects";
import { RuntimeInvalid } from "../../../core/runtime.errors";

import { BuilderRegistry } from "./builder-registry.service";
import { BuilderGitPort, BuilderStateMachinePort } from "./builders.ports";

export type DeploymentBuilderKind =
    | "dockerfile"
    | "docker_compose"
    | "nixpacks"
    | "buildpack"
    | "railpack"
    | "external";

type CliEnablement = {
    node?: boolean;
    bun?: boolean;
    npm?: boolean;
    pnpm?: boolean;
    yarn?: boolean;
}

type CustomCommandsConfig = {
    cli?: CliEnablement;
    buildCommand?: string;
    runCommand?: string;
}

export type BuildArtifactInput = {
    deploymentId: string;
    serviceId: string;
    builder: DeploymentBuilderKind | null;
    sourceCheckout: DeploymentSourceCheckoutContext | null;
    fallbackContainerImage: string | null;
    customCommands?: CustomCommandsConfig | null;
    /** Aborts the build (cancel, lost lease). */
    signal?: AbortSignal | undefined;
}

/** Why a build refused: a rule of the platform, the engine failing, or the checkout/IO collaborator (kept as thrown). */
export type BuildArtifactFailure = RuntimeInvalid | DockerError | unknown;

export type DeploymentArtifactBuilderShape = {
    /** Produces the container image for a deployment; `null` means the runtime is addressed by project name (compose). */
    readonly buildContainerizedArtifact: (input: BuildArtifactInput) => Effect.Effect<string | null, BuildArtifactFailure>;
};

export type DeploymentArtifactBuilderPorts = {
    readonly gitService: Context.Service.Shape<typeof BuilderGitPort>;
    readonly stateMachine: Context.Service.Shape<typeof BuilderStateMachinePort>;
    readonly builderRegistry: Context.Service.Shape<typeof BuilderRegistry>;
};

export class DeploymentArtifactBuilder extends Context.Service<
    DeploymentArtifactBuilder,
    DeploymentArtifactBuilderShape
>()("runtime/DeploymentArtifactBuilder") {
    /** The collaborators are yielded when a method runs, so this is a constant a module provides with `useValue`. */
    static readonly live = serviceOver(
        Effect.all({
            gitService: BuilderGitPort,
            stateMachine: BuilderStateMachinePort,
            builderRegistry: BuilderRegistry,
        }),
        makeDeploymentArtifactBuilder,
    );
}

export function makeDeploymentArtifactBuilder(ports: DeploymentArtifactBuilderPorts): DeploymentArtifactBuilderShape {
    const { gitService, stateMachine: deploymentStateMachineService, builderRegistry } = ports;

    const buildContainerizedArtifact = (input: BuildArtifactInput) =>
        Effect.gen(function* () {
            const hasCustomCommands = hasCustomCommandsIn(input.customCommands ?? null);
            const stateMachine = deploymentStateMachineService.evaluate({
                provider: resolveProviderKind(input.sourceCheckout),
                builder: input.builder,
                runner: null,
                hasContainerImage: Boolean(input.fallbackContainerImage?.trim()),
                hasCustomBuildCommand: Boolean(input.customCommands?.buildCommand?.trim()),
                hasCustomRunCommand: Boolean(input.customCommands?.runCommand?.trim()),
            });
            if (!stateMachine.canProceed) {
                return yield* new RuntimeInvalid({ reason: stateMachine.violations.map((v) => v.message).join(" ") });
            }

            const isCustomManagedBuilder = !input.builder && hasCustomCommands;
            let effectiveBuilder: DeploymentBuilderKind | null = stateMachine.normalizedBuilder;

            if (effectiveBuilder === "external") {
                if (hasCustomCommands) {
                    return yield* new RuntimeInvalid({ reason: "Custom build/run commands require a containerized builder and cannot be used with builder 'external'" });
                }
                if (!input.fallbackContainerImage || input.fallbackContainerImage.trim().length === 0) {
                    return yield* new RuntimeInvalid({ reason: "Builder 'external' requires an explicit prebuilt container image" });
                }
                return input.fallbackContainerImage;
            }

            const sourceCheckout = input.sourceCheckout;

            // Resolve build context from source provider
            let buildContextPath: string;

            if (sourceCheckout?.provider === "github") {
                // Clone the GitHub repository as the build context
                buildContextPath = yield* attempt(() =>
                    gitService.cloneRepository({
                        url: sourceCheckout.repositoryUrl,
                        branch: sourceCheckout.branch,
                        commit: sourceCheckout.commitSha,
                        deploymentId: input.deploymentId,
                    }),
                );
            } else if (sourceCheckout?.provider === "upload") {
                if (!sourceCheckout.uploadPath?.trim()) {
                    return yield* new RuntimeInvalid({ reason: "Upload source checkout must include uploadPath for build stage" });
                }

                const uploadPath = sourceCheckout.uploadPath;
                const uploadStat = yield* attempt(() => stat(uploadPath));
                buildContextPath = uploadStat.isFile()
                    ? yield* attempt(() =>
                          gitService.extractUploadedFile({
                              filePath: uploadPath,
                              deploymentId: input.deploymentId,
                          }),
                      )
                    : uploadPath;
            } else {
                return yield* new RuntimeInvalid({ reason: `Provider '${sourceCheckout?.provider ?? "none"}' is not supported for builder '${effectiveBuilder ?? "none"}'. ` +
                        "Supported providers: github, upload" });
            }

            // With no builder configured, a context that ships a Dockerfile is a
            // Dockerfile build — not a reason to give up. Before this, `undefined`
            // builder fell straight through to the (then-`nginx:alpine`) runner.
            if (!effectiveBuilder && existsSync(path.join(buildContextPath, "Dockerfile"))) {
                effectiveBuilder = "dockerfile";
            }

            if (!effectiveBuilder) {
                if (input.fallbackContainerImage?.trim()) {
                    return input.fallbackContainerImage;
                }
                return yield* new RuntimeInvalid({ reason: "No builder could be resolved and the build context has no Dockerfile at its root. " +
                        "Add a Dockerfile, choose a builder explicitly, or provide a prebuilt container image." });
            }

            yield* assertBuilderContextGuards(effectiveBuilder, buildContextPath, {
                allowDockerfileGuardBypass: isCustomManagedBuilder,
            });

            const customDockerfileName = yield* prepareCustomBuilderDockerfileIfNeeded({
                builder: effectiveBuilder,
                buildContextPath,
                customCommands: input.customCommands ?? null,
            });

            // Dispatch goes through the registry, not an if-chain: the old chain sent nixpacks/
            // buildpack/railpack to `buildImage` with no Dockerfile and threw "Dockerfile not found".
            // Everything above is builder-independent (checkout, extraction, guard, custom-command
            // Dockerfile); only artifact production lives in a strategy.
            const strategy = yield* builderRegistry.resolve(effectiveBuilder);

            // An image build is CPU/IO heavy and long-lived; report it so an image scan
            // started meanwhile plans itself serial (see `docker/services/scan-concurrency.ts`).
            const builder = effectiveBuilder;
            const result = yield* Effect.acquireUseRelease(
                Effect.sync(() => beginHeavyWork("build")),
                () =>
                    strategy.build({
                        buildContextPath,
                        deploymentId: input.deploymentId,
                        serviceId: input.serviceId,
                        dockerfileName: customDockerfileName,
                        imageTag: createImageTag({
                            serviceId: input.serviceId,
                            deploymentId: input.deploymentId,
                            builder,
                        }),
                        signal: input.signal,
                    }),
                (release) => Effect.sync(release),
            );

            // `null` is a legitimate result for compose: the runtime is addressed by project name.
            return result.image;
        });

    // `findComposeFile` lives in the docker_compose strategy: the compose-file probe is that
    // strategy's precondition, and a copy here could disagree about which filenames count.

    return { buildContainerizedArtifact };
}

function hasCustomCommandsIn(customCommands: CustomCommandsConfig | null): boolean {
    const buildCommand = customCommands?.buildCommand?.trim() ?? null;
    const runCommand = customCommands?.runCommand?.trim() ?? null;
    return buildCommand !== null || runCommand !== null;
}

function resolveProviderKind(sourceCheckout: DeploymentSourceCheckoutContext | null): "github" | "upload" | "custom" {
    if (!sourceCheckout) {
        return "upload";
    }
    if (sourceCheckout.provider === "github") {
        return "github";
    }
    if (sourceCheckout.provider === "custom") {
        return "custom";
    }
    return "upload";
}

function prepareCustomBuilderDockerfileIfNeeded(input: {
    builder: DeploymentBuilderKind;
    buildContextPath: string;
    customCommands: CustomCommandsConfig | null | undefined;
}) {
    return Effect.gen(function* () {
        const buildCommand = input.customCommands?.buildCommand?.trim();
        const runCommand = input.customCommands?.runCommand?.trim();

        if (!buildCommand && !runCommand) {
            return null;
        }

        yield* assertCommandCliPolicy({
            buildCommand,
            runCommand,
            cli: input.customCommands?.cli,
        });

        const dockerfileName = "Dockerfile.deployer.custom";
        const dockerfilePath = path.join(input.buildContextPath, dockerfileName);
        const content = renderCustomBuilderDockerfile({
            builder: input.builder,
            buildCommand,
            runCommand,
            cli: input.customCommands?.cli,
        });
        yield* attempt(() => writeFile(dockerfilePath, content, "utf8"));
        return dockerfileName;
    });
}

function assertCommandCliPolicy(input: {
    buildCommand?: string | undefined;
    runCommand?: string | undefined;
    cli?: CliEnablement | undefined;
}) {
    return Effect.gen(function* () {
        const combined = `${input.buildCommand ?? ""}\n${input.runCommand ?? ""}`;
        const normalized = combined.toLowerCase();
        const cli = input.cli ?? {};

        for (const tool of ["bun", "node", "npm", "pnpm", "yarn"] as const) {
            const used = new RegExp(`(^|\\s|&&|\\|\\|)${tool}(\\s|$)`).test(normalized);
            if (used && !cli[tool]) {
                return yield* new RuntimeInvalid({ reason: `custom command uses '${tool}' but execution.customCommands.cli.${tool} is disabled` });
            }
        }
    });
}

function renderCustomBuilderDockerfile(input: {
    builder: DeploymentBuilderKind;
    buildCommand?: string;
    runCommand?: string;
    cli?: CliEnablement;
}): string {
    const cli = input.cli ?? {};
    const buildCommand = input.buildCommand ?? "echo 'no custom build command provided'";
    const runCommand = input.runCommand ?? "npm start";

    const installLines = [
        "RUN apk add --no-cache bash curl git",
        ...(cli.node || cli.npm || cli.pnpm || cli.yarn ? ["RUN apk add --no-cache nodejs npm"] : []),
        ...(cli.bun
            ? [
                  "RUN curl -fsSL https://bun.sh/install | bash",
                  'ENV BUN_INSTALL="/root/.bun"',
                  'ENV PATH="$BUN_INSTALL/bin:$PATH"',
              ]
            : []),
        ...(cli.pnpm ? ["RUN npm install -g pnpm"] : []),
        ...(cli.yarn ? ["RUN npm install -g yarn"] : []),
    ];

    return [
        "FROM alpine:3.20",
        "WORKDIR /app",
        ...installLines,
        "COPY . .",
        `RUN sh -lc ${JSON.stringify(buildCommand)}`,
        `CMD ["sh", "-lc", ${JSON.stringify(runCommand)}]`,
        `LABEL deployer.builder=${JSON.stringify(input.builder)}`,
    ].join("\n");
}

function assertBuilderContextGuards(
    builder: DeploymentBuilderKind,
    contextPath: string,
    options?: {
        allowDockerfileGuardBypass?: boolean;
    },
) {
    return Effect.gen(function* () {
        if (builder === "dockerfile") {
            if (options?.allowDockerfileGuardBypass) {
                return;
            }
            if (!existsSync(path.join(contextPath, "Dockerfile"))) {
                return yield* new RuntimeInvalid({ reason: "Builder 'dockerfile' requires a Dockerfile in the source context" });
            }
            return;
        }

        if (builder === "docker_compose") {
            const composeCandidates = [
                "docker-compose.yml",
                "docker-compose.yaml",
                "compose.yml",
                "compose.yaml",
            ];
            const hasCompose = composeCandidates.some((candidate) =>
                existsSync(path.join(contextPath, candidate)),
            );
            if (!hasCompose) {
                return yield* new RuntimeInvalid({ reason: "Builder 'docker_compose' requires a compose file in upload context" });
            }
            return;
        }

        // nixpacks/buildpack/railpack have no context guard on purpose: they produce their own
        // build plan from the source tree. Their requirements are enforced by their strategy.
    });
}

/** The image tag scheme, in one place so every builder derives the same tag. */
export function createImageTag(input: {
    serviceId: string;
    deploymentId: string;
    builder: DeploymentBuilderKind;
}): string {
    const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9_.-]/g, "-");
    const servicePart = normalize(input.serviceId).slice(0, 24);
    const deploymentPart = normalize(input.deploymentId).slice(0, 32);
    const builderPart = normalize(input.builder).slice(0, 24);
    return `deployer/${servicePart}:${deploymentPart}-${builderPart}`;
}
