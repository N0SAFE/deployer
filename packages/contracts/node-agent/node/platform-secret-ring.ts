import z from 'zod/v4'

/** The platform secret as a ring: the current generation and the earlier ones still accepted, newest first (SEC-101). */
export const platformSecretRingSchema = z.object({
    generation: z.number().int().positive(),
    value: z.string().min(1),
    previous: z.array(
        z.object({
            generation: z.number().int().positive(),
            value: z.string().min(1),
        })
    ),
})

export type PlatformSecretRingValue = z.infer<typeof platformSecretRingSchema>

/** The same ring as a caller may hold it, read-only. */
type ReadonlyRing = {
    readonly generation: number
    readonly value: string
    readonly previous: readonly { readonly generation: number; readonly value: string }[]
}

/**
 * The ring a node ends up with when it learns of another one, or null when it should stay as it is.
 *
 * - Only a HIGHER generation is taken: a node never goes back, and two nodes on the same generation with different values
 *   are a disagreement to show (the inventory flags it), not one to settle silently.
 * - The earlier generations of both are kept, so what either side sealed still opens.
 * - For a generation both rings hold, the value this node already has wins: a peer cannot rewrite history here.
 *
 * One function, used by the agent when it pulls a ring from a peer and by the API's repository when it adopts one.
 */
export function mergePlatformSecretRing(
    local: ReadonlyRing | null,
    incoming: ReadonlyRing
): PlatformSecretRingValue | null {
    if (local !== null && incoming.generation <= local.generation) return null
    const earlier = new Map<number, string>()
    for (const entry of [
        ...(local === null
            ? []
            : [{ generation: local.generation, value: local.value }, ...local.previous]),
        ...incoming.previous,
    ]) {
        if (entry.generation < incoming.generation && !earlier.has(entry.generation)) {
            earlier.set(entry.generation, entry.value)
        }
    }
    return {
        generation: incoming.generation,
        value: incoming.value,
        previous: [...earlier]
            .sort(([a], [b]) => b - a)
            .map(([generation, value]) => ({ generation, value })),
    }
}
