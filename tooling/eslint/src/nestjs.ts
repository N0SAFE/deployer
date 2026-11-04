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
            // Off for Nest: constructor-injected classes must stay VALUE imports
            // (`emitDecoratorMetadata` reads them at runtime). With this rule on,
            // `lint --fix` rewrote them to `import type` and every provider failed
            // to resolve ("can't resolve dependencies ... index [0]").
            "@typescript-eslint/consistent-type-imports": "off",
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
 * `packages/auth` sits BELOW the services and needs the auth tables, so splitting
 * the package would make the dependency `auth → identity → auth`. Until that is
 * resolved, the boundary is stated in `TABLE_OWNERSHIP` and enforced here.
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

/**
 * Authorization is transport-wide (`SEC-062`): `procedure()` from `@deployer/nest-effect` is what appends the authz gate to
 * a handler. `implement()` is the same builder without it, so a controller reaching for the library directly serves an
 * ungated route that still compiles, still boots, and still answers. Refusing the import is the cheapest mechanism that
 * cannot be forgotten: it is checked on every lint run, on every controller file, with no per-controller spec.
 */
const controllersUseProcedure = () =>
    defineConfig([
        {
            files: ["src/**/*.controller.ts"],
            rules: {
                "no-restricted-imports": [
                    "error",
                    {
                        paths: [
                            {
                                name: "@orpc/server",
                                importNames: ["implement"],
                                message:
                                    "Use procedure() from @deployer/nest-effect: it appends the authz gate (SEC-062).",
                            },
                        ],
                    },
                ],
            },
        },
    ]);

/**
 * The Effect conventions, as a gate instead of a code review (`docs/architecture/effect-migration-gap-inventory.md` §12).
 *
 * The rubric's checks C1, C3, C5, C9 and C10 are the ones a machine can answer from one file's AST. Enabling this config
 * is per APP, because a migration is per app: a package that still has 45 `@Injectable` services turns it on the day the
 * last one is a tag, and until then the absence of the rule is the visible TODO.
 *
 * What each block enforces, and why from THAT scope:
 *
 * - `**.controller.ts` may not import `implement()`: the authz gate is appended by `procedure()` (`SEC-062`).
 * - a `services/` or `repositories/` file may not declare `@Injectable()` (C1): a domain service is a `Context.Service`
 *   tag with a `live`, so the runtime owns its lifetime and a spec can swap it with a `Layer`.
 * - the same directories may not `throw new Error(...)` (C5): a failure is a tagged `domainError`, which the transport
 *   maps. A repository's own boundary (`throw` inside `Effect.tryPromise` that becomes `RepositoryFailure`) is exempt by
 *   scope — it is the one place a defect is the honest answer.
 * - ordinary source may not use `console.*` (C9) outside `main.ts` (the boot path has no logger yet) or a test.
 * - ordinary source may not silence the compiler (`@ts-ignore` / `@ts-expect-error`) (C10).
 *
 * Deliberately NOT gated yet: `as unknown as` (C10's other half). The remaining sites are typed ports (`CoreEventSync`
 * wants the concrete service) where the honest fix is a better port type, not a lint suppression — that is a design task,
 * not a sweep, and a rule now would only teach the next author to reach for `as never`.
 */
const effectConventions = () =>
    defineConfig([
        {
            files: ["src/**/*.controller.ts"],
            rules: {
                "no-restricted-imports": [
                    "error",
                    {
                        paths: [
                            {
                                name: "@orpc/server",
                                importNames: ["implement"],
                                message:
                                    "Use procedure() from @deployer/nest-effect: it appends the authz gate (SEC-062).",
                            },
                        ],
                    },
                ],
            },
        },
        {
            files: ["src/**/services/**/*.ts", "src/**/repositories/**/*.ts"],
            ignores: ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/e2e/**"],
            rules: {
                // C1: the tag IS the service. `@Injectable` puts the lifetime back in Nest's hands.
                "no-restricted-imports": [
                    "error",
                    {
                        paths: [
                            {
                                name: "@nestjs/common",
                                importNames: ["Injectable", "Scope"],
                                message:
                                    "A domain service is a Context.Service tag with a `live` (useValue: X.live), not a Nest provider.",
                            },
                        ],
                    },
                ],
            },
        },
        {
            // C5 is scoped to SERVICES on purpose: a repository's `throw` sits inside the `Effect.tryPromise` that turns it
            // into a typed `RepositoryFailure`, so the throw IS the boundary. A service has no such excuse.
            files: ["src/**/services/**/*.ts"],
            ignores: ["src/**/*.spec.ts", "src/**/*.test.ts", "src/**/e2e/**"],
            rules: {
                "no-restricted-syntax": [
                    "error",
                    {
                        selector: "ThrowStatement > NewExpression[callee.name='Error']",
                        message:
                            "Throw a tagged domainError (or an AppError subclass), so the transport maps a STATUS instead of a 500.",
                    },
                    {
                        selector: "ThrowStatement > NewExpression[callee.name='TypeError']",
                        message:
                            "Throw a tagged domainError (or an AppError subclass), so the transport maps a STATUS instead of a 500.",
                    },
                ],
            },
        },
        {
            files: ["src/**/*.ts"],
            ignores: ["src/main.ts", "src/**/*.spec.ts", "src/**/*.test.ts", "src/**/e2e/**"],
            rules: {
                // C9: the Logger carries the context and the level; `console` carries neither.
                "no-console": "error",
                // C10: a suppression hides the type error the architecture is built on.
                "@typescript-eslint/ban-ts-comment": [
                    "error",
                    { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true },
                ],
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
        controllersUseProcedure,
        effectConventions,
    },
} as const;
