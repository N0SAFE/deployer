import { describe, expect, it } from "vitest";
import {
    buildersCatalog,
    builderConfigValidators,
    builderSchemasCatalog,
    providersCatalog,
    providerConfigValidators,
    providerSchemasCatalog,
} from "@deployer/provider-schema/index";

describe("provider-schema catalog integrity", () => {
    it("keeps provider catalogs, schemas, and validators aligned", () => {
        const providerIds = providersCatalog.map((provider) => provider.id);

        for (const id of providerIds) {
            expect(providerSchemasCatalog[id]).toBeDefined();
            expect(providerConfigValidators[id]).toBeDefined();
        }
    });

    it("keeps builder catalogs, schemas, and validators aligned", () => {
        const builderIds = buildersCatalog.map((builder) => builder.id);

        for (const id of builderIds) {
            expect(builderSchemasCatalog[id]).toBeDefined();
            expect(builderConfigValidators[id]).toBeDefined();
        }
    });

    /**
     * The catalog MUST agree with the builders the deployment pipeline accepts.
     *
     * This assertion was missing, and its absence is why the catalog drifted: it listed
     * `"static"` — a builder with no strategy and no member in
     * `deploymentBuilderKindSchema` — while omitting `docker_compose`, `buildpack`,
     * `railpack` and `external`. Self-consistency (the test above) cannot catch that:
     * a catalog can be internally consistent and still describe features that do not
     * exist. Comparing against the deployment enum is the only check that ties the UI's
     * options to reality.
     */
    it("lists exactly the builders the deployment pipeline accepts", () => {
        const deploymentBuilderKinds = [
            "dockerfile",
            "docker_compose",
            "nixpacks",
            "buildpack",
            "railpack",
            "external",
        ];

        expect(buildersCatalog.map((builder) => builder.id).sort()).toEqual(
            [...deploymentBuilderKinds].sort(),
        );
    });

    it("has no builder config schema for a builder that does not exist", () => {
        const catalogIds = new Set(buildersCatalog.map((builder) => builder.id));

        for (const id of Object.keys(builderSchemasCatalog)) {
            expect(catalogIds.has(id)).toBe(true);
        }
        for (const id of Object.keys(builderConfigValidators)) {
            expect(catalogIds.has(id)).toBe(true);
        }
    });

    it("validates known valid provider config", () => {
        const githubValidator = providerConfigValidators.github;
        expect(githubValidator).toBeDefined();

        if (!githubValidator) {
            return;
        }

        const parsed = githubValidator.safeParse({
            repositoryUrl: "https://github.com/org/repo",
            branch: "main",
        });

        expect(parsed.success).toBe(true);
    });

    it("rejects invalid provider config", () => {
        const githubValidator = providerConfigValidators.github;
        expect(githubValidator).toBeDefined();

        if (!githubValidator) {
            return;
        }

        const parsed = githubValidator.safeParse({
            repositoryUrl: "not-a-url",
        });

        expect(parsed.success).toBe(false);
    });
});
