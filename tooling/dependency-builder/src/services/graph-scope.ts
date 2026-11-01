import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Outcome of {@link stripApplications}. Every branch is a fact the caller logs;
 * none of them is an exception, because "already stripped" is the normal state
 * after the first container start.
 */
export type StripResult =
    | { status: 'stripped'; removed: string[] }
    | { status: 'unchanged'; reason: string }
    | { status: 'failed'; reason: string }

/**
 * Remove `apps/**` from the root manifest's workspace list, on disk.
 *
 * ── WHY THE MANIFEST AND NOT A FILTER ───────────────────────────────────────
 * `turbo watch` rebuilds whatever in the graph changes, including the
 * applications that DEPEND on a changed package, so leaving `apps/**` in the
 * workspace list ran `api:build`, `web:build` and `setup:build` inside this
 * container:
 *
 *     web:build: error: Unexpected while resolving package 'handlebars'
 *     web#build:  ERROR  command (/app/apps/web) ... exited (1)
 *
 * `--filter=!./apps/**` does not fix that: filters select which tasks to RUN,
 * but dependents of a changed package still enter the graph. The workspace list
 * is the structural lever.
 *
 * ── WHY IT IS SHARED WITH THE IMAGE ─────────────────────────────────────────
 * Turbo hashes the resolved task graph, so a bake taken with a DIFFERENT
 * workspace list is a cache the runtime can never hit. `strip-applications.ts`
 * calls THIS function before the image's bake, which is what makes the first
 * `turbo watch` pass after `initial_sync` a replay instead of a recompile.
 *
 * ── WHY DISCOVERY SURVIVES ──────────────────────────────────────────────────
 * `WorkspaceScanner` treats the conventional trees as always-scanned (see
 * `workspaceRoots`), so applications stay discoverable from `COMPOSE_PROFILES`
 * even though the manifest no longer lists them.
 *
 * Only `apps`-prefixed entries are removed: `packages/**`, `tooling/**` and
 * `infra/**` are what the union is built from.
 */
export function stripApplications(root: string): StripResult {
    const manifestPath = join(root, 'package.json')

    let raw: { workspaces?: { packages?: string[] } | string[] }
    try {
        raw = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof raw
    } catch {
        return { status: 'failed', reason: `unreadable ${manifestPath}` }
    }

    const workspaces = raw.workspaces
    const list =
        workspaces === undefined
            ? undefined
            : Array.isArray(workspaces)
              ? workspaces
              : workspaces.packages

    if (list === undefined) {
        return { status: 'unchanged', reason: 'no workspaces list' }
    }

    const kept = list.filter((entry) => !entry.startsWith('apps'))
    if (kept.length === list.length) {
        return { status: 'unchanged', reason: 'already stripped' }
    }

    if (Array.isArray(workspaces)) {
        raw.workspaces = kept
    } else if (workspaces !== undefined) {
        workspaces.packages = kept
    }

    writeFileSync(manifestPath, `${JSON.stringify(raw, null, 4)}\n`)

    return {
        status: 'stripped',
        removed: list.filter((entry) => entry.startsWith('apps')),
    }
}
