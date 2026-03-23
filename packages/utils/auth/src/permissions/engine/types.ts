/**
 * types.ts — All types for the resource-rule permission engine.
 *
 * These types underpin the dynamic permission system where org-level roles
 * carry JSON `resourceRules` that are evaluated by the PermissionEngine.
 */

// ---------------------------------------------------------------------------
// Resources & Actions
// ---------------------------------------------------------------------------

export type ProjectResource = "project" | "service" | "deployment" | "logs" | "webhook" | "apiKey" | "environment";

export type ResourceAction = string;

// ---------------------------------------------------------------------------
// Scope types
// ---------------------------------------------------------------------------

export interface ResourceScopeAll {
    type: "all";
}

export interface ResourceScopeIds {
    type: "ids";
    values: string[];
}

export interface ResourceScopeCascade {
    type: "cascade";
    /** Which ancestor resource type to inherit access from. */
    from: ProjectResource;
}

export interface ResourceScopeFilter {
    type: "filter";
    /** Directus-style JSON condition evaluated against a record. */
    condition: DFilter;
}

export type ResourceScope = ResourceScopeAll | ResourceScopeIds | ResourceScopeCascade | ResourceScopeFilter;

// ---------------------------------------------------------------------------
// DFilter — Directus-style JSON filter language
// ---------------------------------------------------------------------------

/**
 * Any scalar value that a filter operator can compare against.
 * Matches what is safely serialisable to/from JSON.
 */
export type FilterableScalar = string | number | boolean | null;

// ---------------------------------------------------------------------------
// Variable — typed runtime variable reference
// ---------------------------------------------------------------------------

// Unique symbol — makes Variable a nominal type (prevents plain { name: "x" } from matching).
declare const variableBrand: unique symbol;

/**
 * A typed reference to a named runtime variable.
 *
 * `K` is inferred as the **string-literal key** from the constructor argument:
 * `new Variable("$currentUser")` produces `Variable<"$currentUser">`.
 *
 * When embedded in a `DFilter<TSchema, TVars>`, TypeScript validates that `K` is a
 * key of `TVars` **whose value type is compatible with the operator's field type**:
 *  - `{ ownerId: { _eq: new Variable("$currentUser") } }` is only valid when
 *    `TVars["$currentUser"]` extends `string` (the field type of `ownerId`).
 *  - `{ id: { _in: new Variable("$accessibleProjects") } }` is only valid when
 *    `TVars["$accessibleProjects"]` extends `string[]`.
 *  - Passing `Variable<"$accessibleProjects">` (a `string[]` var) to a `_eq`
 *    field that expects `string` is a **compile-time error**.
 *
 * `TVars` is inferred from the `vars` argument of `compileDFilter`/`matchFilter`,
 * so explicit generics are rarely needed at call sites.
 *
 * @example
 * ```ts
 * // K inferred as "$currentUser"; valid when TVars["$currentUser"] extends string
 * { ownerId: { _eq: new Variable("$currentUser") } }
 *
 * // K inferred as "$accessibleProjects"; valid when TVars["$accessibleProjects"] extends string[]
 * { id: { _in: new Variable("$accessibleProjects") } }
 * ```
 */
export class Variable<K extends string = string> {
    /** Nominal brand — carries K so that Variable<"$a"> ≠ Variable<"$b"> structurally. */
    declare readonly [variableBrand]: K;

    constructor(readonly name: K) {}
}

/** Returns `true` when `v` is a `Variable` instance (any key-type). */
export function isVariable(v: unknown): v is Variable {
    return v instanceof Variable;
}

/**
 * Keys of `TVars` whose value type is assignable to (extends) `T`.
 *
 * Used internally by `OrVar` to constrain which variable names are permitted
 * for a given operator field type. If no key in `TVars` has a compatible value
 * type, this resolves to `never` — preventing any Variable from being used there.
 *
 * @example
 * ```ts
 * type MyVars = { $currentUser: string; $projectIds: string[]; $count: number };
 * type StringKeys = VarKeysFor<MyVars, string>;   // "$currentUser"
 * type ArrayKeys  = VarKeysFor<MyVars, string[]>; // "$projectIds"
 * ```
 */
export type VarKeysFor<TVars extends object, T> = {
    [K in keyof TVars & string]: TVars[K] extends T ? K : never;
}[keyof TVars & string];

/**
 * Either a literal value `T` or a `Variable` whose `TVars`-lookup is type-compatible with `T`.
 *
 * `Variable<VarKeysFor<TVars, T>>` restricts the variable name to only those keys
 * in `TVars` where the corresponding value type extends `T`. If no such key exists,
 * the Variable union arm collapses to `Variable<never>` (uninhabited), effectively
 * disallowing any Variable there.
 */
export type OrVar<T, TVars extends object = object> =
    T | Variable<VarKeysFor<TVars, T>>;

/**
 * Per-field filter operators.
 *
 * @typeParam V      TypeScript value type of the field being filtered.
 * @typeParam TVars  Runtime variables map — constrains which `Variable` names are
 *                   valid for each operator based on type compatibility with `V`.
 *                   Defaults to an open `Record<string, unknown>` (any variable name
 *                   allowed) so that unparameterised use still compiles.
 */
export interface DFilterOperator<V = FilterableScalar, TVars extends object = object> {
    // Equality — scalar literal or Variable whose TVars value extends V
    _eq?: V extends FilterableScalar ? OrVar<V, TVars> : OrVar<FilterableScalar, TVars>;
    _neq?: V extends FilterableScalar ? OrVar<V, TVars> : OrVar<FilterableScalar, TVars>;
    // Inclusion — array literal or Variable whose TVars value extends V[]
    _in?: OrVar<(V extends FilterableScalar ? V : FilterableScalar)[], TVars>;
    _nin?: OrVar<(V extends FilterableScalar ? V : FilterableScalar)[], TVars>;
    // Null checks — boolean only, no Variable
    _null?: boolean;
    _nnull?: boolean;
    // String operators — string literal or Variable whose TVars value extends string
    _contains?: OrVar<string, TVars>;
    _icontains?: OrVar<string, TVars>;
    _starts_with?: OrVar<string, TVars>;
    _ends_with?: OrVar<string, TVars>;
    // Numeric comparisons — value or Variable whose TVars value extends number | string
    _gt?: OrVar<number | string, TVars>;
    _gte?: OrVar<number | string, TVars>;
    _lt?: OrVar<number | string, TVars>;
    _lte?: OrVar<number | string, TVars>;
}

/**
 * Strongly-typed recursive filter condition.
 *
 * @typeParam TSchema  Maps field-path strings to their TypeScript value types.
 *                     Use a concrete schema type for full safety, or the default
 *                     `Record<string, FilterableScalar | FilterableScalar[]>` for
 *                     unknown field sets.
 * @typeParam TVars    Runtime variables map. Each `Variable` used in the filter must
 *                     name a key of `TVars` whose value type is compatible with the
 *                     field's type. Defaults to `DynamicVars`.
 *
 * @example
 * ```ts
 * type ProjectSchema = { name: string; budget: number; ownerId: string };
 *
 * // TVars inferred from `vars` argument — no explicit generics needed:
 * compileDFilter(
 *   { ownerId: { _eq: new Variable("$currentUser") } },  // valid only if TVars["$currentUser"] extends string
 *   resolver,
 *   { $currentUser: "user-42" },   // TVars inferred as { $currentUser: string }
 * );
 * ```
 */
export type DFilter<
    TSchema extends object = Record<string, FilterableScalar | FilterableScalar[]>,
    TVars extends object = DynamicVars,
> = string extends keyof TSchema
    ? // Loose branch: TSchema has a string index (e.g. the default Record<string,…>).
      {
          _and?: DFilter<TSchema, TVars>[];
          _or?: DFilter<TSchema, TVars>[];
      } & Record<string, DFilterOperator<FilterableScalar | FilterableScalar[], TVars> | DFilter<TSchema, TVars>[] | undefined>
    : // Strict branch: TSchema has specific literal keys (concrete schema interface).
      {
          _and?: DFilter<TSchema, TVars>[];
          _or?: DFilter<TSchema, TVars>[];
      } & {
          [K in keyof TSchema as K extends "_and" | "_or" ? never : K]?: DFilterOperator<TSchema[K & keyof TSchema], TVars>;
      };

// ---------------------------------------------------------------------------
// ResourceRule — the core unit stored in organization_role.resource_rules JSONB
// ---------------------------------------------------------------------------

export interface ResourceRule {
    /** Target resource type, or "*" for all resources. */
    resource: ProjectResource | "*";
    /** Target action(s), or "*" for all actions. */
    actions: ResourceAction[] | "*";
    /** Scope constraint restricting which instances this rule applies to. */
    scope: ResourceScope;
    /**
     * If true, this rule explicitly denies the action.
     * Deny rules with higher priority override allow rules.
     * Ties: deny wins over allow.
     * Default: false (allow).
     */
    deny?: boolean;
    /**
     * Priority for conflict resolution. Higher number = wins in tie-breaks.
     * Default: 0.
     */
    priority?: number;
}

// ---------------------------------------------------------------------------
// Engine context — passed on every check() / assert() call
// ---------------------------------------------------------------------------

/** Known dynamic variable keys that can be referenced in DFilterOperator. */
export interface DynamicVars {
    $currentUser: string;
    $currentOrg: string;
    $accessibleProjects: string[];
    $accessibleServices: string[];
}

export interface EngineContext {
    userId: string;
    orgId: string;
    /** User's platform-level role (e.g. "superAdmin", "admin", "user"). */
    platformRole?: string;
    /**
     * Pre-resolved dynamic variables for filter evaluation.
     * At minimum $currentUser and $currentOrg are auto-populated from userId/orgId.
     */
    vars?: Partial<DynamicVars>;
}

// ---------------------------------------------------------------------------
// Engine result types
// ---------------------------------------------------------------------------

export type PermissionDecision = "ALLOW" | "DENY";

export interface PermissionCheckResult {
    decision: PermissionDecision;
    /** The winning rule that produced this decision, if any. */
    matchedRule?: ResourceRule;
    reason: string;
}
