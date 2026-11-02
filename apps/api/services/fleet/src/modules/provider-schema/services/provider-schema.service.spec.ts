import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";

import { FleetNotFound } from "@/core/fleet.errors";

import { ProviderSchemaService } from "./provider-schema.service";

const service = ProviderSchemaService.live;
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const failure = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.flip(effect));

describe("ProviderSchemaService", () => {
    it("returns all providers", async () => {
        const providers = await run(service.getAllProviders());
        expect(providers.length).toBeGreaterThan(0);
        expect(providers[0]).toHaveProperty("id");
    });

    it("returns all builders", async () => {
        const builders = await run(service.getAllBuilders());
        expect(builders.length).toBeGreaterThan(0);
        expect(builders[0]).toHaveProperty("id");
    });

    it("fails with a typed FleetNotFound when the provider schema is missing", async () => {
        const error = await failure(service.getProviderSchema("missing-provider"));
        expect(error).toBeInstanceOf(FleetNotFound);
        expect(error.publicMessage()).toBe("Provider schema 'missing-provider' not found");
    });

    it("returns compatible builders for provider", async () => {
        const builders = await run(service.getCompatibleBuilders("github"));
        expect(builders.length).toBeGreaterThan(0);
        expect(
            builders.every((builder) =>
                ["dockerfile", "docker_compose", "nixpacks", "buildpack", "railpack", "external"].includes(builder.id),
            ),
        ).toBe(true);
    });

    it("returns compatible providers for builder", async () => {
        const providers = await run(service.getCompatibleProviders("dockerfile"));
        expect(providers.some((provider) => provider.id === "github")).toBe(true);
    });

    it("validates provider config successfully", async () => {
        const result = await run(
            service.validateProviderConfig("github", {
                repositoryUrl: "https://github.com/org/repo",
                branch: "main",
            }),
        );
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("returns validation errors, with the failing path, for an invalid provider config", async () => {
        const result = await run(service.validateProviderConfig("github", { repositoryUrl: "not-a-url" }));
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some((line) => line.startsWith("repositoryUrl"))).toBe(true);
    });

    it("fails with FleetNotFound when validating an unknown builder, and does not defect", async () => {
        const exit = await Effect.runPromiseExit(service.validateBuilderConfig("unknown-builder", {}));
        expect(Exit.isFailure(exit)).toBe(true);
        expect(await failure(service.validateBuilderConfig("unknown-builder", {}))).toBeInstanceOf(FleetNotFound);
    });
});
