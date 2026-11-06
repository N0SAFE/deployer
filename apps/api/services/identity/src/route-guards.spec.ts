import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every procedure this service mounts is either authenticated or EXPLICITLY public (`SEC-065`).
 *
 * The requirement gate proves a handler's Effect requirements are satisfied; it says nothing about whether the handler
 * checks a session. A controller method that forgets `.use(requireAuth())` compiles, boots, and serves an endpoint to
 * anyone — which is exactly the class of bug a review is least likely to catch on a large diff.
 *
 * This is a SOURCE check on purpose: it reads the controllers as text, so it sees the middleware chain the way a reviewer
 * does, and a new file under `modules/` is covered without being registered anywhere.
 */

// `import.meta.dir` is Bun-only; vitest runs this under Node.
const MODULES = join(dirname(fileURLToPath(import.meta.url)), 'modules')

/** A procedure that may be served without a session, with the reason it is allowed. */
const PUBLIC_ALLOWLIST = new Set<string>([
    // Health/readiness and the email-exists probe are public by design; the probe is anonymous and rate-limited.
    'userContract.checkEmail',
])

function controllerFiles(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
        const path = join(directory, entry)
        if (statSync(path).isDirectory()) return controllerFiles(path)
        return path.endsWith('.controller.ts') ? [path] : []
    })
}

/** `@Implement(x.y)` occurrences with the body that follows each, up to the next handler. */
function procedures(): { file: string; contract: string; body: string }[] {
    const found: { file: string; contract: string; body: string }[] = []

    for (const file of controllerFiles(MODULES)) {
        const source = readFileSync(file, 'utf8')
        const markers = [...source.matchAll(/@Implement\(([^)]+)\)/g)]

        markers.forEach((marker, index) => {
            const start = marker.index
            const end = markers[index + 1]?.index ?? source.length
            found.push({
                file,
                contract: (marker[1] ?? '').trim(),
                body: source.slice(start, end),
            })
        })
    }

    return found
}

describe('identity route guards', () => {
    const mounted = procedures()

    it('finds the procedures it is meant to check', () => {
        // A guard that silently scans nothing is worse than no guard.
        expect(mounted.length).toBeGreaterThan(10)
    })

    it('authenticates every procedure, except the explicit public allowlist', () => {
        // A procedure is authenticated by a USER session, by the MESH (`SEC-069`), or by a signed SYSTEM-ACTOR claim a peer
        // service made (`requireSystemActor`): a peer call has no browser session, and the handler says which trust it rests on.
        const unguarded = mounted
            .filter((procedure) => !PUBLIC_ALLOWLIST.has(procedure.contract))
            .filter(
                (procedure) =>
                    !procedure.body.includes('requireAuth()') &&
                    !procedure.body.includes('requireMesh()') &&
                    !procedure.body.includes('requireSystemActor(')
            )
            .map((procedure) => `${procedure.file} → ${procedure.contract}`)

        expect(unguarded).toEqual([])
    })

    it('keeps the public allowlist honest: each entry really is public', () => {
        const bypassing = mounted
            .filter((procedure) => PUBLIC_ALLOWLIST.has(procedure.contract))
            .filter((procedure) => procedure.body.includes('requireAuth()'))
            .map((procedure) => procedure.contract)

        expect(bypassing).toEqual([])
    })
})
