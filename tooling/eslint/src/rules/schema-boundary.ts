/**
 * `schema-boundary` — a service may only reference the schema tables its owner may read.
 *
 * ── WHY A CUSTOM RULE ───────────────────────────────────────────────────────
 * Ownership is physical (`global/<owner>/`), but a single schema file can export
 * tables with different owners: `global/project/deployment.ts` holds `projects`
 * (readable by runtime and identity) and `webhooks` (project-only). A path-based
 * `no-restricted-imports` rule therefore cannot express the boundary — it can only
 * ban whole directories, which would either allow too much or forbid the reads the
 * registry explicitly grants.
 *
 * This rule checks the imported SYMBOLS against the registry, so the answer matches
 * `mayRead` exactly. It reads that registry (a pure data module) directly, which means
 * adding a table, claiming an owner, or granting a shared read needs NO regeneration
 * and NO config change: the next lint follows the registry.
 *
 * A boundary violation is reported per symbol, naming the fix, so the error tells you
 * whether to claim the table or to declare a shared read with a reason.
 */
import type { Rule } from "eslint";

import { loadSchemaOwnership } from "../schema-ownership";

/**
 * Resolved by every service through its own Better Auth adapter, so they are not a
 * domain boundary — `identity` owns the rows, but any service may read `session`.
 */
const AUTH_TABLES = new Set([
    "user",
    "session",
    "account",
    "verification",
    "apikey",
    "passkey",
    "two_factor",
    "device_code",
]);

/** Directories every owner may read: app-wide config/versions and zod helpers. */
const CROSS_CUTTING = new Set(["platform", "utils"]);

const SCHEMA_PREFIX = "@deployer/nest-schema/global/";

/** `userVapidKeys` -> `user_vapid_keys`, matching how the tables are declared. */
const toTableName = (symbol: string): string => symbol.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

export interface SchemaBoundaryOptions {
    /** The service whose ownership applies, e.g. `runtime`. */
    readonly owner: string;
}

export function createSchemaBoundaryRule(options: SchemaBoundaryOptions): Rule.RuleModule {
    const { owner } = options;

    return {
        meta: {
            type: "problem",
            docs: {
                description:
                    "Restrict schema imports to the tables this service's owner may read (TABLE_OWNERSHIP / SHARED_TABLES).",
            },
            schema: [],
            messages: {
                unionBarrel:
                    "Import the schema directory that declares the table, not the union barrel: `@deployer/nest-schema/global/<owner>/<file>`. The union barrel makes every table reachable regardless of ownership.",
                notReadable:
                    "`{{table}}` is owned by `{{tableOwner}}` and `{{service}}` may not read it. Either claim it in TABLE_OWNERSHIP, or add a SHARED_TABLES entry naming {{service}} as a reader with a reason — reachable tables are declared in packages/nest/schema/src/ownership/table-ownership.ts, not chosen at the import site.",
            },
        },

        create(context) {
            let ownership: ReturnType<typeof loadSchemaOwnership>;
            try {
                ownership = loadSchemaOwnership();
            } catch (error) {
                // A lint rule must never take the build down: report once and stop.
                context.report({
                    loc: { line: 1, column: 0 },
                    message: `schema-boundary could not load the ownership registry: ${String(error)}`,
                });
                return {};
            }

            const check = (node: { source: { value?: unknown } }, specifiers: readonly unknown[]): void => {
                const source = node.source.value;
                if (typeof source !== "string") return;

                if (source === "@deployer/nest-schema/global") {
                    context.report({ node: node as never, messageId: "unionBarrel" });
                    return;
                }
                if (!source.startsWith(SCHEMA_PREFIX)) return;

                const directory = source.slice(SCHEMA_PREFIX.length).split("/")[0];
                // This service's own directory, plus the cross-cutting ones, is fine.
                if (directory === owner || CROSS_CUTTING.has(directory)) return;

                for (const specifier of specifiers) {
                    const imported = specifier as { type?: string; imported?: { name?: string } };
                    const symbol = imported.imported?.name;
                    if (symbol === undefined) continue; // namespace / default: nothing to check

                    const table = toTableName(symbol);
                    if (AUTH_TABLES.has(table)) continue;

                    const tableOwner = ownership.tableOwnership[table];
                    // Not a table (a zod schema, enum or type) — a type has no runtime
                    // ownership, and derived schemas follow their table's file.
                    if (tableOwner === undefined) continue;

                    if (ownership.multiOwner.has(table)) continue;
                    const readers = ownership.readers[table];
                    if (readers !== undefined && readers.includes(owner)) continue;

                    context.report({
                        node: specifier as never,
                        messageId: "notReadable",
                        data: { table, tableOwner, service: owner },
                    });
                }
            };

            return {
                ImportDeclaration: (node) => check(node, node.specifiers),
                // `type X = import("...").Y` and `typeof import("...").Y`
                TSImportType: (node) => {
                    const arg = node.argument as { value?: unknown } | undefined;
                    if (arg === undefined) return;
                    const qualifier = (node as { qualifier?: { name?: string } }).qualifier;
                    check({ source: arg }, qualifier ? [{ imported: { name: qualifier.name } }] : []);
                },
            };
        },
    };
}
