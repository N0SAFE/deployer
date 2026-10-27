import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import type { BuilderStrategy } from "./base/builder-strategy.interface";
import { BuilderRegistryService } from "./builder-registry.service";
import { BuildpackFamilyBuilderStrategy } from "./strategies/buildpack-family-builder.strategy";
import { DockerComposeBuilderStrategy } from "./strategies/docker-compose-builder.strategy";
import { DockerfileBuilderStrategy } from "./strategies/dockerfile-builder.strategy";

const strategy = (builderType: string, available = true): BuilderStrategy => ({
    builderType,
    isAvailable: () => available,
    unavailableReason: () => (available ? "" : `${builderType} is not installed`),
    build: vi.fn().mockResolvedValue({ image: null }),
});

describe("BuilderRegistryService", () => {
    it("resolves a registered, available builder case-insensitively", () => {
        const registry = new BuilderRegistryService([strategy("dockerfile")]);
        expect(registry.resolve("Dockerfile").builderType).toBe("dockerfile");
        expect(registry.isSupported("DOCKERFILE")).toBe(true);
    });

    it("rejects an unknown builder naming the supported ones", () => {
        const registry = new BuilderRegistryService([strategy("dockerfile"), strategy("docker_compose")]);
        expect(() => registry.resolve("nope")).toThrow(BadRequestException);
        expect(() => registry.resolve("nope")).toThrow(/Supported: dockerfile, docker_compose/);
        expect(registry.isSupported("nope")).toBe(false);
    });

    it("separates 'registered but unavailable' from 'unknown', with the reason", () => {
        const registry = new BuilderRegistryService([strategy("remote", false)]);
        expect(() => registry.resolve("remote")).toThrow(/registered but unavailable: remote is not installed/);
        expect(registry.isSupported("remote")).toBe(false);
        expect(registry.supportedBuilders()).toEqual([{ builderType: "remote", available: false, reason: "remote is not installed" }]);
    });

    it("the later strategy wins when a type is registered twice", () => {
        const first = strategy("dockerfile");
        const second = strategy("dockerfile");
        expect(new BuilderRegistryService([first, second]).resolve("dockerfile")).toBe(second);
    });
});

describe("builder strategies", () => {
    const docker = () => ({ buildImage: vi.fn().mockResolvedValue(undefined), buildCompose: vi.fn().mockResolvedValue({ projectName: "p" }) });
    const context = { buildContextPath: "/ctx", deploymentId: "0123456789abcdef", serviceId: "s", dockerfileName: null, imageTag: "deployer/s:d-x" };

    it("dockerfile builds one image, passing the custom Dockerfile when there is one", async () => {
        const d = docker();
        const s = new DockerfileBuilderStrategy(d as never);
        await expect(s.build(context)).resolves.toEqual({ image: "deployer/s:d-x" });
        expect(d.buildImage).toHaveBeenCalledWith("/ctx", "deployer/s:d-x", {});
        await s.build({ ...context, dockerfileName: "Dockerfile.deployer.custom" });
        expect(d.buildImage).toHaveBeenLastCalledWith("/ctx", "deployer/s:d-x", { dockerfileName: "Dockerfile.deployer.custom", autoCreateDockerfile: false });
    });

    it.each(["nixpacks", "buildpack", "railpack"] as const)("%s without custom commands fails with an actionable message, not 'Dockerfile not found'", async (kind) => {
        const d = docker();
        const s = new BuildpackFamilyBuilderStrategy(kind, d as never);
        await expect(s.build(context)).rejects.toThrow(/requires custom build and run commands/);
        expect(d.buildImage).not.toHaveBeenCalled();
    });

    it("a buildpack-family builder with custom commands builds the generated Dockerfile", async () => {
        const d = docker();
        await new BuildpackFamilyBuilderStrategy("nixpacks", d as never).build({ ...context, dockerfileName: "Dockerfile.deployer.custom" });
        expect(d.buildImage).toHaveBeenCalledWith("/ctx", "deployer/s:d-x", { dockerfileName: "Dockerfile.deployer.custom", autoCreateDockerfile: false });
    });

    it("docker_compose refuses custom commands and a missing compose file, and never returns an image", async () => {
        const d = docker();
        const s = new DockerComposeBuilderStrategy(d as never);
        await expect(s.build({ ...context, dockerfileName: "x" })).rejects.toThrow(/cannot be combined/);
        await expect(s.build(context)).rejects.toThrow(/requires a compose file/);
        expect(d.buildCompose).not.toHaveBeenCalled();
    });
});
