import eslintNestJs from "@darraghor/eslint-plugin-nestjs-typed";
import { defineConfig } from "eslint/config";
import { Linter } from "eslint"
import coreConfig, { type BaseConfigOptions } from "./base";
import { createSchemaBoundaryRule } from "./rules/schema-boundary";
const coreBaseFactory = coreConfig.configs.base;
const coreTestFactory = coreConfig.configs.test;

const sharedRules: Partial<Linter.RulesRecord> = {
            "@darraghor/nestjs-typed/api-enum-property-best-practices": "off",
            "@typescript-eslint/interface-name-prefix": "off",
            "@typescript-eslint/explicit-function-return-type": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "@typescript-eslint/no-extraneous-class": "off",
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
            "no-unused-vars": "off",
            "@typescript-eslint/consistent-type-imports": [
                "error",
                {
                    prefer: "type-imports",
                },
            ],
            "@darraghor/nestjs-typed/param-decorator-name-matches-route-param": "off",
            "@darraghor/nestjs-typed/controllers-should-supply-api-tags": "off",
            "@darraghor/nestjs-typed/injectable-should-be-provided": "off",
        }

const base = (options: BaseConfigOptions = {}) => defineConfig([
    coreBaseFactory(options),
    ...(eslintNestJs.configs.flatRecommended as any),
    {
        rules: sharedRules
    },
]);

const test = (options: BaseConfigOptions = {}) => defineConfig([
    coreTestFactory(options),
    ...(eslintNestJs.configs.flatRecommended as any),
    {
        rules: sharedRules
    },
    // Relaxed rules for test files
    {
        files: ["**/*.spec.ts", "**/*.test.ts", "**/*.mock.ts"],
        rules: {
            "@typescript-eslint/no-unsafe-assignment": "off",
            "@typescript-eslint/no-unsafe-member-access": "off",
            "@typescript-eslint/no-unsafe-call": "off",
            "@typescript-eslint/no-unsafe-argument": "off",
            "@typescript-eslint/no-unsafe-return": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/no-unnecessary-condition": "off",
            "@typescript-eslint/no-extraneous-class": "off",
            "@darraghor/nestjs-typed/injectable-should-be-provided": "off",
        },
    },
]);

const all = (options: BaseConfigOptions = {}) => defineConfig([
    base(options),
    test(options),
]);

/**
 * A domain service may only import the schema tables it owns.
 *
 * ── WHY A LINT RULE AND NOT PACKAGE BOUNDARIES ──────────────────────────────
 * One schema package per service would make the violation unrepresentable, but
 * `packages/auth` sits BELOW the services and needs the auth tables, and
 * `apps/api` (the monolith being retired) reads every table — splitting the
 * package would force splitting both, in the same change. Until the monolith
 * goes, the boundary is stated in `TABLE_OWNERSHIP` and enforced here.
 *
 * Ownership is PHYSICAL: `packages/nest/schema/src/global/<owner>/` holds exactly
 * the tables that owner owns, so an illegal import is an illegal PATH and this rule
 * can see it without any generated barrel to keep in sync. The union barrel
 * (`@deployer/nest-schema/global`) is banned outright: it is what makes an unowned
 * table reachable regardless of ownership.
 *
 * To give a service access to a table you either claim the table for it, or add it
 * to `SHARED_TABLES` with a reason — both are reviewed changes to the registry.
 *
 * ── WHY TEST FILES ARE EXEMPT ───────────────────────────────────────────────
 * An e2e fixture that exercises a deployment flow has to create a whole aggregate
 * (project → service → deployment) to do it. Forcing that through the owning
 * service's API would make the fixture depend on other services being up, which
 * is exactly the coupling fixtures exist to avoid. Seeding is a test concern.
 */
interface ServiceSchemaBoundaryOptions {
    /** The owning directory this service may import, e.g. `runtime`. */
    owner: string;
}

const serviceSchemaBoundary = (options: ServiceSchemaBoundaryOptions) =>
    defineConfig([
        {
            files: ["src/**/*.ts"],
            ignores: ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/e2e/**"],
            plugins: {
                // Registered under a local alias so the rule needs no published plugin.
                "deployer-schema": {
                    rules: { boundary: createSchemaBoundaryRule({ owner: options.owner }) },
                },
            },
            rules: {
                "deployer-schema/boundary": "error",
            },
        },
    ]);

export default {
    meta: {
        name: "@deployer/config-eslint/nestjs",
        version: "0.0.0",
    },
    configs: {
        base,
        test,
        all,
        serviceSchemaBoundary,
    },
} as const;
