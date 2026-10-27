#!/usr/bin/env bun
/**
 * The ONE entry point for every compose file in this repository.
 *
 * ── WHY A SCRIPT AND NOT A SHELL ONE-LINER ─────────────────────────────────
 * The package.json one-liners had to split "which profiles" from "which compose
 * command" inside `sh -c`, and `sh` cannot do it. `bun run dev:filter api web up
 * --build` gives `$1=api` and `$@=web up --build`, so the shell either consumed
 * only ONE profile or passed `web` to compose as a SERVICE name. Both are silent
 * wrong answers — the second starts nothing and reports success.
 *
 * So the split is done here, against a set that is DISCOVERED rather than
 * hardcoded: the leading arguments are consumed as profiles only while they name
 * a profile the file actually declares (`docker compose config --profiles`).
 * That makes every one of these correct, with no separator syntax to remember:
 *
 *   bun run dev                                  -> all
 *   bun run dev:filter api                       -> api
 *   bun run dev:filter api web                   -> api,web
 *   bun run dev:filter api,web                   -> api,web
 *   bun run dev:filter api up --build            -> api, then `up --build`
 *   bun run dev down                             -> all, then `down`
 *
 * ── WHY PROFILES AT ALL ────────────────────────────────────────────────────
 * A profile is what decides whether a service starts. Infrastructure (`redis`,
 * `traefik`, the `dependency-builder`) declares NO profile and is therefore
 * active in every case — it is a prerequisite of each application rather than an
 * alternative to any. Application services list `all` (the default) plus the
 * names that select them.
 *
 * ── WHY THE VALUE REACHES THE CONTAINERS ───────────────────────────────────
 * The `dependency-builder` decides which applications' packages to build by
 * reading `COMPOSE_PROFILES`. Compose does NOT inject that variable into
 * containers on its own — the propagation is an explicit `environment:` entry in
 * the compose files (`COMPOSE_PROFILES: ${COMPOSE_PROFILES:-all}`). This script
 * sets the variable so BOTH happen: compose activates the profiles, and the
 * interpolation hands the builder the same list the running containers were
 * selected by. That is what keeps the built union and the running set from
 * drifting.
 *
 * ── PRECEDENCE ─────────────────────────────────────────────────────────────
 *   1. profiles named on the command line   (`bun run dev:filter api`)
 *   2. `COMPOSE_PROFILES` from the environment / `.env`
 *   3. `all`
 *
 * The command line wins so a one-off filtered run is not defeated by the
 * `COMPOSE_PROFILES=all` the developer's `.env` carries.
 *
 * ── USAGE ──────────────────────────────────────────────────────────────────
 *   bun scripts/compose.ts --file <name> [--require-profile] [profiles...] [compose args...]
 *
 * `--file` names a file in `infra/docker/compose/`, so the script is the single
 * place that knows where compose files live and the package.json scripts only
 * name WHICH one to use.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const COMPOSE_DIR = join(ROOT, 'infra', 'docker', 'compose')

/** The profile every application service belongs to; the default selection. */
const DEFAULT_PROFILE = 'all'

/**
 * Compose's own subcommands, as far as this script needs to tell them apart from
 * a profile name.
 *
 * Only used to phrase an error: when no profile is selected, knowing whether the
 * first argument was a command (`up`) or a mistyped profile (`nope`) is the
 * difference between "you forgot the profile" and "that profile does not exist".
 */
const COMMANDS = new Set([
    'attach',
    'build',
    'commit',
    'config',
    'cp',
    'create',
    'down',
    'events',
    'exec',
    'images',
    'kill',
    'logs',
    'ls',
    'pause',
    'port',
    'ps',
    'publish',
    'pull',
    'push',
    'restart',
    'rm',
    'run',
    'scale',
    'start',
    'stats',
    'stop',
    'top',
    'unpause',
    'up',
    'version',
    'wait',
    'watch',
])

function die(message: string): never {
    console.error(`compose: ${message}`)
    process.exit(1)
}

/** The compose files available in `infra/docker/compose/`, for error messages. */
function composeFiles(): string[] {
    try {
        return readdirSync(COMPOSE_DIR).filter((name) => name.endsWith('.yml'))
    } catch {
        return []
    }
}

/**
 * The profiles a compose file declares, asked of compose itself.
 *
 * Discovered rather than hardcoded: a list in this file would drift from the
 * compose files the moment one gained a profile, and the failure would be a
 * silently-ignored argument rather than an error.
 */
function declaredProfiles(file: string): string[] {
    const result = spawnSync(
        'docker',
        ['compose', '-f', file, 'config', '--profiles'],
        { encoding: 'utf8' }
    )
    if (result.error !== undefined && result.error !== null) {
        die(
            `could not run docker compose (is docker installed and on PATH?)\n  ${result.error.message}`
        )
    }
    if (result.status !== 0) {
        die(
            `could not read the profiles declared by ${file}\n` +
                `${(result.stderr ?? '').trim() || '(no output)'}`
        )
    }
    return (result.stdout ?? '').split(/\s+/).filter(Boolean)
}

/** Split `--file <name>` / `--require-profile` out of the argument list. */
function parseArgs(argv: string[]): {
    file: string
    requireProfile: boolean
    rest: string[]
} {
    let file: string | undefined
    let requireProfile = false
    const rest: string[] = []

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index]!
        if (arg === '--file' || arg === '-f') {
            file = argv[index + 1]
            index += 1
            continue
        }
        if (arg.startsWith('--file=')) {
            file = arg.slice('--file='.length)
            continue
        }
        if (arg === '--require-profile') {
            requireProfile = true
            continue
        }
        rest.push(arg)
    }

    if (file === undefined || file.length === 0) {
        die('--file <name> is required (e.g. --file docker-compose.dev.yml)')
    }
    return { file, requireProfile, rest }
}

function main(): void {
    const { file, requireProfile, rest } = parseArgs(process.argv.slice(2))
    const composeFile = join(COMPOSE_DIR, file)
    if (!existsSync(composeFile)) {
        die(
            `no such compose file: ${file}\n` +
                `  looked in ${COMPOSE_DIR}\n` +
                `  available: ${composeFiles().join(', ')}`
        )
    }

    const known = declaredProfiles(composeFile)

    // ── CONSUME THE LEADING PROFILE ARGUMENTS ──────────────────────────────
    // A head is taken as profiles only while EVERY name in it is a profile the
    // file declares. `up`, `down` and `--build` are not, so the first compose
    // command ends the scan — which is what lets the two forms coexist without a
    // separator.
    //
    // Both `,` and whitespace separate names, because the argument arrives
    // differently depending on how it was typed and which shell expanded it:
    // `bun run dev:filter api web` yields two arguments, while `bun run
    // dev:filter 'api web'` yields one. Splitting on both makes every spelling
    // mean the same thing instead of one of them silently selecting `all`.
    const profiles: string[] = []
    while (rest.length > 0) {
        const head = rest[0]!
        const names = head
            .split(/[,\s]+/)
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0)
        if (names.length === 0 || !names.every((name) => known.includes(name))) {
            break
        }
        for (const name of names) {
            if (!profiles.includes(name)) profiles.push(name)
        }
        rest.shift()
    }

    if (profiles.length === 0) {
        // A named-but-unknown profile is the common mistake (a typo, or a
        // profile another compose file declares). Reporting it as "no profile
        // named" would send the operator looking for a missing argument instead
        // of at the name they actually typed.
        const firstNonFlag = rest.find((arg) => !arg.startsWith('-'))
        const looksLikeProfile =
            firstNonFlag !== undefined && !COMMANDS.has(firstNonFlag)

        if (requireProfile) {
            const hint =
                looksLikeProfile && firstNonFlag !== undefined
                    ? `"${firstNonFlag}" is not a profile ${file} declares`
                    : 'no profile named'
            die(
                `${hint}\n` +
                    `  usage: bun run dev:filter <profile...> [compose args...]\n` +
                    `  profiles ${file} declares: ${known.join(', ')}`
            )
        }
        const fromEnv = process.env['COMPOSE_PROFILES']?.trim()
        profiles.push(
            fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : DEFAULT_PROFILE
        )
    }

    const selected = profiles.join(',')

    // ── NO COMMAND MEANS `up -d` ───────────────────────────────────────────
    // Every `dev:*` script that names no compose command (`dev`, `dev:services`,
    // `dev:supervised`, …) relies on this. Without it compose prints its usage
    // text and exits 0 — a successful run that started nothing, which is the
    // worst outcome a convenience script can have.
    //
    // `-d` rather than a blocking `up`: these scripts are invoked from an editor
    // task and `dev:*:logs` exists to follow them. A blocking `up` would hold the
    // terminal and make the documented `dev` + `dev:logs` pair unusable.
    //
    // `--build` is NOT added. It is expensive and, for most profiles, unnecessary
    // (the images are current); the profiles whose images MUST be rebuilt say so
    // in their own docs and the operator passes `up --build` — which reaches
    // compose verbatim because the args below are passed through untouched.
    const command = rest.length > 0 ? rest : ['up', '-d']

    console.log(
        `compose: ${file}  profiles=${selected}  args=${command.join(' ')}`
    )

    // `COMPOSE_PROFILES` is set rather than passed as `--profile` flags: the
    // variable both ACTIVATES the profiles and INTERPOLATES into the compose
    // files' `environment:` entries, which is how the dependency-builder learns
    // the same selection. `--profile` does neither for the container.
    const result = spawnSync(
        'docker',
        ['compose', '-f', composeFile, ...command],
        {
            stdio: 'inherit',
            env: { ...process.env, COMPOSE_PROFILES: selected },
        }
    )

    // Forward the child's status so `bun run dev ...` is usable in a pipeline and
    // a failed compose command is not reported as success.
    if (result.error !== undefined && result.error !== null) {
        die(result.error.message)
    }
    process.exit(result.status ?? 0)
}

main()
