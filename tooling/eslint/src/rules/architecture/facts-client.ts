import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { DEFAULT_GLOBS, factsSchema, gateOptionsSchema } from './facts-schema'
import type { Facts, GateOptions } from './facts-schema'

/** One snapshot over a whole monorepo takes ~11 s; ten minutes is a hang, not a slow run. */
const TIMEOUT_MS = 10 * 60 * 1000

/**
 * The facts process, wherever this module runs from: `dist/architecture-facts.mjs` once built (the plugin is bundled flat
 * next to it), `src/architecture-facts.ts` when the rules are imported from source (Bun runs TypeScript).
 */
function helperPath(): string {
    const candidates = [
        new URL('./architecture-facts.mjs', import.meta.url),
        new URL('../../architecture-facts.ts', import.meta.url),
    ]
    const found = candidates
        .map((url) => fileURLToPath(url))
        .find((path) => existsSync(path))
    if (found === undefined)
        throw new Error(
            `deployer-effect: the facts process is missing; looked for ${candidates.map(String).join(' and ')}. Run \`bun run build\` in tooling/eslint.`
        )
    return found
}

/** Parse the rule options once, at the boundary; a typo in an option is an error, not a silently ignored key. */
export function parseOptions(raw: unknown): GateOptions {
    const parsed = gateOptionsSchema.safeParse(raw ?? {})
    if (!parsed.success)
        throw new Error(
            `deployer-effect: invalid rule options — ${parsed.error.issues.map((issue) => `${issue.path.join('.') || 'options'}: ${issue.message}`).join('; ')}`
        )
    return parsed.data
}

function runFacts(root: string, globs: readonly string[]): Facts {
    // `bun` explicitly: under the ESLint CLI or an editor `process.execPath` is node, and the facts process is TypeScript/Bun.
    const runtime =
        process.versions.bun === undefined ? 'bun' : process.execPath
    const run = spawnSync(
        runtime,
        [helperPath(), root, JSON.stringify(globs)],
        { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, timeout: TIMEOUT_MS }
    )

    if (run.error !== undefined) {
        const code = (run.error as NodeJS.ErrnoException).code
        if (code === 'ENOENT')
            throw new Error(
                'deployer-effect: `bun` was not found on PATH; the facts process needs it.'
            )
        if (code === 'ETIMEDOUT')
            throw new Error(
                `deployer-effect: the facts process did not finish in ${TIMEOUT_MS / 1000}s.`
            )
        throw run.error
    }
    if (run.status !== 0)
        throw new Error(
            `deployer-effect: the facts process failed (exit ${run.status}).\n${run.stderr.trim()}`
        )

    let raw: unknown
    try {
        raw = JSON.parse(run.stdout)
    } catch {
        throw new Error(
            `deployer-effect: the facts process printed something that is not JSON.\n${run.stdout.slice(0, 300)}`
        )
    }
    const parsed = factsSchema.safeParse(raw)
    if (!parsed.success)
        throw new Error(
            `deployer-effect: the facts do not match the schema — ${parsed.error.issues[0]?.path.join('.')}: ${parsed.error.issues[0]?.message}`
        )
    return parsed.data
}

interface Cached {
    readonly facts: Facts
    readonly at: number
    readonly watched: readonly string[]
}

const cache = new Map<string, Cached>()

/**
 * An editor keeps ONE long-lived ESLint process, so facts are recomputed when a file they were built from has been saved
 * since. shortcut: only files the facts already know are watched (modules, owners, usage sites) — a brand-new module, or a
 * type that changes in a file outside that set, shows up on the next recompute or an editor restart.
 */
function isStale(cached: Cached): boolean {
    return cached.watched.some((file) => {
        try {
            return statSync(file).mtimeMs > cached.at
        } catch {
            return true // deleted or moved
        }
    })
}

export function loadFacts(options: GateOptions, cwd: string): Facts {
    const root = options.root ?? cwd
    const globs = options.globs ?? DEFAULT_GLOBS
    const key = JSON.stringify([root, globs])

    const cached = cache.get(key)
    if (cached !== undefined && !isStale(cached)) return cached.facts

    const startedAt = Date.now()
    const facts = runFacts(root, globs)
    cache.set(key, {
        facts,
        at: startedAt,
        watched: [
            ...new Set([
                ...Object.keys(facts.files),
                ...Object.keys(facts.sites),
            ]),
        ],
    })
    return facts
}

/** The real path of a linted file: facts are keyed by real paths, and a workspace symlink must not make a file look unanalysed. */
export function realFile(filename: string): string {
    try {
        return realpathSync(filename)
    } catch {
        return filename
    }
}

/**
 * Whether the editor buffer differs from the file on disk. Facts describe the DISK; positions in an unsaved buffer would
 * point somewhere else, so the rules stay quiet until it is saved rather than reporting at the wrong place.
 */
export function isUnsaved(text: string, file: string): boolean {
    try {
        return readFileSync(file, 'utf8').replace(/^﻿/, '') !== text
    } catch {
        return false
    }
}
