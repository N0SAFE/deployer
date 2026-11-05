import { createHash } from 'node:crypto'

/** Anything a supervisor can be identified by: a plain key, or the fields that tell instances apart. */
export type SupervisorIdentifierInput =
    string | number | Record<string, unknown> | null | undefined

/**
 * The stable registry id of a supervisor: `base` alone for a single-instance supervisor, and
 * `base:<digest of the input>` for one of several instances, so each gets a distinct, deterministic id.
 */
export function supervisorIdentifier(
    base: string,
    input?: SupervisorIdentifierInput
): string {
    if (input === undefined || input === null) return base
    const serialized =
        typeof input === 'string' || typeof input === 'number'
            ? String(input)
            : JSON.stringify(
                  Object.entries(input).sort(([a], [b]) => a.localeCompare(b))
              )
    return `${base}:${createHash('sha256').update(`${base}:${serialized}`).digest('hex').slice(0, 12)}`
}
