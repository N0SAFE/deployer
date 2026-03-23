import { describe, expect, it } from "vitest";
import {
    buildersCatalog,
    builderConfigValidators,
    builderSchemasCatalog,
    providersCatalog,
    providerConfigValidators,
    providerSchemasCatalog,
} from "../index";

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
