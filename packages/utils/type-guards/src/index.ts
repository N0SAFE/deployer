/**
 * @fileoverview Shared TypeScript type guard utilities.
 *
 * These predicates provide runtime type narrowing for values that come from
 * untrusted sources (HTTP responses, SSE events, database rows, env vars,
 * user input, third-party libraries). They replace `as Record<string, unknown>`
 * and `as unknown as X` type assertions across the monorepo.
 *
 * ## Why this package exists
 *
 * Before this package, the same `isRecord` function was duplicated in
 * 69+ files. This is a DRY violation. Centralizing them:
 *
 * 1. Ensures consistent behavior across the monorepo
 * 2. Makes the type guards easy to find, audit, and test
 * 3. Prevents subtle drift (some versions included `!Array.isArray`,
 *    some didn't)
 * 4. Makes the "is this a record?" decision explicit at call sites
 *
 * ## Usage
 *
 * ```typescript
 * import { isRecord, isObjectLike, hasProperty, isString } from "@repo/type-guards"
 *
 * if (isRecord(value)) {
 *   // value is narrowed to Record<string, unknown>
 *   if (isString(value.message)) {
 *     // value.message is narrowed to string
 *   }
 * }
 * ```
 *
 * ## Adding a new type guard
 *
 * 1. Add the function to this file with a clear JSDoc comment
 * 2. Add a unit test in `src/__tests__/` (if test infrastructure exists)
 * 3. Re-export it from the barrel
 * 4. Update the documentation comment
 */

// ---------------------------------------------------------------------------
// Object type guards
// ---------------------------------------------------------------------------

/**
 * Narrow `unknown` to `Record<string, unknown>` — a non-array, non-null
 * object whose property values are all `unknown`.
 *
 * This is the most commonly used type guard in the codebase. It replaces
 * the pattern `value as Record<string, unknown>` (a type lie) with a
 * truthful runtime check.
 *
 * **Use this when**: you need to access arbitrary string keys on a
 * value that comes from `unknown` (HTTP response, SSE event, third-party
 * library, user input).
 *
 * **Don't use this when**: the value is a typed object (use the type
 * directly) or a known primitive (use `typeof` directly).
 *
 * @example
 * ```typescript
 * const raw = JSON.parse(jsonString) // unknown
 * if (isRecord(raw)) {
 *   if (typeof raw.message === "string") {
 *     // raw.message is string
 *   }
 * }
 * ```
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Narrow `unknown` to `Record<string, unknown>` — same as `isRecord` but
 * accepts arrays (some runtime shapes use arrays like records). Use
 * `isRecord` when the value must be a true object.
 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

// ---------------------------------------------------------------------------
// Property-based type guards
// ---------------------------------------------------------------------------

/**
 * Type-safe property check. Returns `true` if `value` is an object
 * that has the given key (regardless of the value's type).
 *
 * @example
 * ```typescript
 * if (hasProperty(raw, "message") && typeof raw.message === "string") {
 *   // raw is now narrowed to { message: string }
 * }
 * ```
 */
export function hasProperty<K extends string>(
  value: unknown,
  key: K,
): value is Record<K, unknown> {
  return isRecord(value) && key in value
}

// ---------------------------------------------------------------------------
// Primitive type guards
// ---------------------------------------------------------------------------

/**
 * Narrow `unknown` to `string`. Excludes `""` — use `isNonEmptyString` if
 * you need to require at least one character.
 */
export function isString(value: unknown): value is string {
  return typeof value === "string"
}

/**
 * Narrow `unknown` to `string` with at least one character. The
 * contract schemas use `z.string().min(1)` for non-empty strings; this
 * guard matches that contract.
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0
}

/**
 * Narrow `unknown` to `number`. Excludes `NaN` — use `isFiniteNumber` if
 * you need to reject `NaN` and `Infinity`.
 */
export function isNumber(value: unknown): value is number {
  return typeof value === "number"
}

/**
 * Narrow `unknown` to a finite number (rejects `NaN`, `Infinity`,
 * `-Infinity`).
 */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * Narrow `unknown` to `boolean`.
 */
export function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

/**
 * Narrow `unknown` to a non-null object. Same as `isRecord` but
 * without the property-type constraint. Use this when you want to
 * accept any object shape (including instances of classes).
 *
 * @example
 * ```typescript
 * if (isObject(date)) {
 *   // date is narrowed to object (not unknown)
 *   if (date instanceof Date) { ... }
 * }
 * ```
 */
export function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null
}

// ---------------------------------------------------------------------------
// Array type guards
// ---------------------------------------------------------------------------

/**
 * Narrow `unknown` to a non-empty array. Useful for "at least one
 * element" checks before mapping/iterating.
 */
export function isNonEmptyArray<T>(value: unknown): value is [T, ...T[]] {
  return Array.isArray(value) && value.length > 0
}

// ---------------------------------------------------------------------------
// Error type guards
// ---------------------------------------------------------------------------

/**
 * Narrow `unknown` to an `Error` instance. Use this before accessing
 * `error.message` or `error.stack` on a value of type `unknown`.
 */
export function isError(value: unknown): value is Error {
  return value instanceof Error
}

/**
 * Narrow `unknown` to an object that has a string `message` property.
 * Useful for HTTP error responses that follow the `{ message: string }`
 * shape.
 */
export function isObjectWithMessage(
  value: unknown,
): value is { message: string } {
  return (
    isObject(value) &&
    "message" in value &&
    typeof (value).message === "string"
  )
}

// ---------------------------------------------------------------------------
// Domain-specific guards: NOT HERE
// ---------------------------------------------------------------------------
//
// This package contains ONLY generic shape checks. Domain-specific type
// guards (e.g. "is this a Docker container?", "is this a valid URL?",
// "is this a semantic version?") do NOT belong here.
//
// Why?
// 1. A shared type-guards package that grows domain-specific helpers
//    becomes a junk drawer. The package name stops being descriptive.
// 2. Domain types belong with their domain code. A Docker type guard
//    should live next to the Docker schema, not in a generic utility.
// 3. For non-trivial shapes, **prefer Zod schemas over hand-rolled
//    type guards**. Zod gives you:
//      - Runtime validation
//      - TypeScript type inference (`z.infer<typeof schema>`)
//      - Default values
//      - Refinements, transforms, and unions
//      - A single source of truth
//
// Where to put domain-specific validation:
//   - API: `apps/api/src/modules/<domain>/_validation/` or inline in
//     the service that uses it. Use Zod schemas from
//     `@repo/contracts-entities` or `@repo/api-contracts` as the
//     source of truth.
//   - Web: `apps/web/src/domains/<domain>/_validation/` or inline.
//     Same Zod pattern.
//
// Example: instead of writing `isContainerEntity(value)` here, use
//   `dockerContainerSchema.safeParse(value).success` at the call site
//   — the schema is the truth, and you get a typed result for free.

