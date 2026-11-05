const isProcedure = (value: unknown): boolean =>
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    '~orpc' in (value as Record<string, unknown>)

/** Every procedure of a contract tree, as its dotted path, in a stable order. */
function leafPaths(
    contract: unknown,
    prefix: readonly string[] = []
): string[] {
    if (typeof contract !== 'object' || contract === null) {
        return []
    }
    const paths: string[] = []
    for (const [key, child] of Object.entries(contract)) {
        if (key === '~orpc') continue
        if (isProcedure(child)) {
            paths.push([...prefix, key].join('.'))
        } else {
            paths.push(...leafPaths(child, [...prefix, key]))
        }
    }
    return paths.sort()
}

/** FNV-1a, 32 bit, as hex: the same on every process, which is what two sides that never talk to agree on need. */
function fingerprint(text: string): string {
    let value = 0x811c9dc5
    for (let index = 0; index < text.length; index += 1) {
        value ^= text.charCodeAt(index)
        value = Math.imul(value, 0x01000193) >>> 0
    }
    return (value >>> 0).toString(16).padStart(8, '0')
}

/**
 * The name a contract goes by on the mesh.
 *
 * A service answers several contracts (the project service serves `project`, `service`, `domain` and more), and the paths
 * inside them are relative to their own root, so two of them can name a procedure the same way. The caller and the service
 * both hold the same contract package, so both derive the same id from what the contract declares, with nothing to keep
 * in step: the service mounts each contract under its id, and the caller prefixes its calls with it.
 */
export function contractId(contract: unknown): string {
    return fingerprint(leafPaths(contract).join('\n'))
}
