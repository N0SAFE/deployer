/**
 * rule-validator.ts
 *
 * Zod v4 schemas for validating ResourceRule[] before they are stored
 * in the `organization_role.resource_rules` JSONB column.
 *
 * Enforces:
 *  - Max filter depth of MAX_FILTER_DEPTH (10) via a custom refinement.
 *  - Max 500 rules per role.
 *  - All required fields present and correctly typed.
 *  - Correct discriminant for ResourceScope union.
 *  - Exactly one operator key per DFilterOperator.
 */

import z from "zod/v4";
import { MAX_FILTER_DEPTH } from "./filter-matcher";
import { Variable } from "./types";
import type { ProjectResource, ResourceRule } from "./types";
import { isRecord, isObjectLike } from "@repo/type-guards"

// ---------------------------------------------------------------------------
// Resource & action schemas
// ---------------------------------------------------------------------------


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
const PROJECT_RESOURCES_LIST = [
    "project",
    "service",
    "deployment",
    "logs",
    "webhook",
    "apiKey",
    "environment",
] as const satisfies [ProjectResource, ...ProjectResource[]];

export const projectResourceSchema = z.enum(PROJECT_RESOURCES_LIST);

export const resourceOrWildcardSchema = z.union([projectResourceSchema, z.literal("*")]);

export const actionsSchema = z.union([z.array(z.string().min(1)).min(1), z.literal("*")]);

// ---------------------------------------------------------------------------
// DFilterOperator schema
// ---------------------------------------------------------------------------

export const dFilterOperatorSchema = z
    .object({
        _eq: z.union([z.string(), z.number(), z.boolean(), z.instanceof(Variable)]).optional(),
        _neq: z.union([z.string(), z.number(), z.boolean(), z.instanceof(Variable)]).optional(),
        _in: z.union([z.array(z.union([z.string(), z.number()])), z.instanceof(Variable)]).optional(),
        _nin: z.union([z.array(z.union([z.string(), z.number()])), z.instanceof(Variable)]).optional(),
        _null: z.boolean().optional(),
        _nnull: z.boolean().optional(),
        _contains: z.union([z.string(), z.instanceof(Variable)]).optional(),
        _icontains: z.union([z.string(), z.instanceof(Variable)]).optional(),
        _starts_with: z.union([z.string(), z.instanceof(Variable)]).optional(),
        _ends_with: z.union([z.string(), z.instanceof(Variable)]).optional(),
        _gt: z.union([z.number(), z.instanceof(Variable)]).optional(),
        _gte: z.union([z.number(), z.instanceof(Variable)]).optional(),
        _lt: z.union([z.number(), z.instanceof(Variable)]).optional(),
        _lte: z.union([z.number(), z.instanceof(Variable)]).optional(),
    })
    .refine(
        (op) =>
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            Object.values(op).filter((v) => v !== undefined).length === 1,
        { message: "DFilterOperator must contain exactly one operator key" },
    );

// ---------------------------------------------------------------------------
// DFilter schema (recursive with lazy reference + depth guard)
// ---------------------------------------------------------------------------

/**
 * DFilter is recursive; z.lazy is required for self-referencing Zod schemas.
 * The accompanying depth-check refinement on `resourceRuleSchema` enforces the
 * 10-level max independently.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- z.lazy requires any
const dFilterSchema: z.ZodType<any> = z.lazy(() =>
    z.record(
        z.string(),
        z.union([dFilterOperatorSchema, z.array(dFilterSchema), z.undefined()]),
    ),
);

/**
 * Recursively counts the maximum nesting depth of a DFilter.
 * Used to enforce MAX_FILTER_DEPTH at storage time.
 */
function filterDepth(filter: Record<string, unknown>, current = 0): number {
    if (current > MAX_FILTER_DEPTH) return current; // short-circuit
    let max = current;

    for (const value of Object.values(filter)) {
        if (Array.isArray(value)) {
            for (const sub of value) {
                if (sub !== null && typeof sub === "object" && !Array.isArray(sub)) {
                    const d = filterDepth(sub as Record<string, unknown>, current + 1);
                    if (d > max) max = d;
                }
            }
        }
    }

    return max;
}

export const validatedDFilterSchema = dFilterSchema.refine(
    (f: Record<string, unknown>) => filterDepth(f) <= MAX_FILTER_DEPTH,
    { message: `DFilter nesting exceeds MAX_FILTER_DEPTH (${String(MAX_FILTER_DEPTH)})` },
);

// ---------------------------------------------------------------------------
// ResourceScope schemas
// ---------------------------------------------------------------------------

export const resourceScopeAllSchema = z.object({
    type: z.literal("all"),
});

export const resourceScopeIdsSchema = z.object({
    type: z.literal("ids"),
    values: z.array(z.uuid()).min(1),
});

export const resourceScopeCascadeSchema = z.object({
    type: z.literal("cascade"),
    from: projectResourceSchema,
});

export const resourceScopeFilterSchema = z.object({
    type: z.literal("filter"),
    condition: validatedDFilterSchema,
});

export const resourceScopeSchema = z.discriminatedUnion("type", [
    resourceScopeAllSchema,
    resourceScopeIdsSchema,
    resourceScopeCascadeSchema,
    resourceScopeFilterSchema,
]);

// ---------------------------------------------------------------------------
// ResourceRule schema
// ---------------------------------------------------------------------------

export const resourceRuleSchema = z.object({
    resource: resourceOrWildcardSchema,
    actions: actionsSchema,
    scope: resourceScopeSchema,
    deny: z.boolean().optional(),
    priority: z.number().int().min(0).optional(),
});

export const resourceRulesSchema = z.array(resourceRuleSchema).max(500);

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw unknown value as ResourceRule[].
 * Throws ZodError on failure.
 */
export function parseResourceRules(raw: unknown): ResourceRule[] {
    return resourceRulesSchema.parse(raw);
}

/** The return type of a safeParse call on resourceRulesSchema. */
export type ResourceRulesSafeParseResult = ReturnType<
    typeof resourceRulesSchema.safeParse
>;

/**
 * Safe-parse variant — returns a success/failure result without throwing.
 */
export function safeParseResourceRules(raw: unknown): ResourceRulesSafeParseResult {
    return resourceRulesSchema.safeParse(raw);
}
