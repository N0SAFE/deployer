/**
 * Apply the runtime's workspace-graph scope at IMAGE build time.
 *
 * The runtime strips `apps/**` before its first Turbo process; the image bakes
 * the cache with the same function, so the two hashes agree and the bake is
 * reachable at runtime. One implementation, two callers — see
 * `services/graph-scope.ts` for why the manifest is the lever.
 *
 *   bun --bun src/strip-applications.ts <repo-root>
 */
import { stripApplications } from './services/graph-scope'

const root = process.argv[2] ?? process.cwd()
const result = stripApplications(root)

if (result.status === 'failed') {
    console.error(`[strip-applications] ${result.reason}`)
    process.exit(1)
}

console.log(
    result.status === 'stripped'
        ? `[strip-applications] excluded: ${result.removed.join(', ')}`
        : `[strip-applications] nothing to do (${result.reason})`
)
