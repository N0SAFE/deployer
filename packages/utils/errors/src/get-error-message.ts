/**
 * getErrorMessage — W-F13 (as-any remediation, quick win)
 *
 * Single source of truth for turning an unknown thrown value into a readable
 * message. Kills the `(err as any)?.message` spread (22 web call sites).
 *
 * Precedence:
 *   1. AppError / Error `.message` (if it's a real Error instance)
 *   2. A non-Error object with a `message` string property
 *   3. A JSON rendering for an object, `String(v)` for a primitive — covers strings, numbers and opaque values
 *      without ever printing `[object Object]` or rethrowing.
 */
export function getErrorMessage(error: unknown): string {
    if (error === undefined || error === null) {
        return 'Unknown error'
    }

    if (error instanceof Error) {
        return error.message
    }

    if (typeof error === 'object') {
        const candidate = (error as { message?: unknown }).message
        if (typeof candidate === 'string' && candidate.length > 0) {
            return candidate
        }
    }

    if (typeof error === 'string' && error.length > 0) {
        return error
    }

    // A plain object stringifies to `[object Object]`, which tells an operator nothing: render it instead, and fall back
    // to the constructor name when it cannot be rendered (a circular structure, a throwing getter).
    if (typeof error === 'object') {
        return describeObject(error)
    }

    if (typeof error === 'function') {
        return error.name || 'function'
    }

    // A primitive has a useful string form; anything left (an empty string, `null`, `undefined`) does not.
    if (
        typeof error === 'number' ||
        typeof error === 'boolean' ||
        typeof error === 'bigint'
    ) {
        return String(error)
    }

    if (typeof error === 'symbol') {
        return error.description ?? 'symbol'
    }

    return 'Unknown error'
}

/** A readable, non-throwing rendering of a thrown object. */
function describeObject(value: object): string {
    try {
        const json = JSON.stringify(value)
        if (typeof json === 'string' && json.length > 0) return json
    } catch {
        // Circular or BigInt-bearing value: the constructor name is still better than `[object Object]`.
    }
    return value.constructor.name || 'Object'
}
