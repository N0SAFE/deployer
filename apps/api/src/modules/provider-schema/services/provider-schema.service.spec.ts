import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it } from "vitest";
import { ProviderSchemaService } from "./provider-schema.service";

describe("ProviderSchemaService", () => {
    let service: ProviderSchemaService;

    beforeEach(() => {
        service = new ProviderSchemaService();
    });

    it("returns all providers", () => {
        const providers = service.getAllProviders();
        expect(providers.length).toBeGreaterThan(0);
        expect(providers[0]).toHaveProperty("id");
    });

    it("returns all builders", () => {
        const builders = service.getAllBuilders();
        expect(builders.length).toBeGreaterThan(0);
        expect(builders[0]).toHaveProperty("id");
    });

    it("throws when provider schema is missing", () => {
        expect(() => service.getProviderSchema("missing-provider")).toThrow(NotFoundException);
    });

    it("returns compatible builders for provider", () => {
        const builders = service.getCompatibleBuilders("github");
        expect(builders.length).toBeGreaterThan(0);
        expect(builders.every((builder) => ["dockerfile", "nixpacks", "static"].includes(builder.id))).toBe(
            true,
        );
    });

    it("returns compatible providers for builder", () => {
        const providers = service.getCompatibleProviders("static");
        expect(providers.some((provider) => provider.id === "github")).toBe(true);
    });

    it("validates provider config successfully", () => {
        const result = service.validateProviderConfig("github", {
            repositoryUrl: "https://github.com/org/repo",
            branch: "main",
        });

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it("returns validation errors for invalid provider config", () => {
        const result = service.validateProviderConfig("github", {
            repositoryUrl: "not-a-url",
        });

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("throws when validating unknown builder", () => {
        expect(() => service.validateBuilderConfig("unknown-builder", {})).toThrow(NotFoundException);
    });
});
