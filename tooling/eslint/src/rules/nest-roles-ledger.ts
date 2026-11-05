import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import z from 'zod/v4'

import { NEST_ROLE_RULE_NAMES } from './nest-roles'

/** Every rule that forbids a Nest role, `noInjectableService` included — the rules a ledger may list files under. */
export const ROLE_RULE_NAMES = [
    'noInjectableService',
    ...NEST_ROLE_RULE_NAMES,
] as const

const ledgerSchema = z.partialRecord(
    z.enum(ROLE_RULE_NAMES),
    z.array(z.string().min(1))
)
export type Ledger = z.infer<typeof ledgerSchema>

/**
 * An app's migration ledger: `{ rule: [files that still violate it] }`, read from a JSON file next to its eslint config.
 *
 * It is the visible, shrinking to-do list: a rule is ON for the whole app, and the files listed are the ones not migrated yet.
 * Parsed with one schema (an unknown rule name or a non-array is an error, not a silently ignored key), and an entry whose
 * file no longer exists FAILS the config load — a migrated or deleted file must leave the list, or the list stops being true.
 *
 * PATHS DO NOT DEPEND ON THE WORKING DIRECTORY. Entries are relative to the LEDGER'S directory (which is the app's, and is
 * what a flat config's `files` globs are relative to), and the ledger itself should be passed as an absolute path
 * (`${import.meta.dirname}/nest-roles.ledger.json`). The pre-commit hook lints staged files from the repository root, so a
 * path resolved against `process.cwd()` worked inside an app and failed at the root.
 */
export function readLedger(path: string | undefined): Ledger {
    if (path === undefined) return {}
    const file = isAbsolute(path) ? path : resolve(process.cwd(), path)
    if (!existsSync(file))
        throw new Error(
            `nestRoles: the ledger ${path} does not exist (looked for ${file}).`
        )

    const parsed = ledgerSchema.safeParse(
        JSON.parse(readFileSync(file, 'utf8'))
    )
    if (!parsed.success) {
        throw new Error(
            `nestRoles: ${path} is not a valid ledger — ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`
        )
    }
    for (const [rule, files] of Object.entries(parsed.data)) {
        for (const entry of files ?? []) {
            if (!existsSync(resolve(dirname(file), entry))) {
                throw new Error(
                    `nestRoles: ${path} lists ${entry} under ${rule}, which no longer exists. Delete the entry.`
                )
            }
        }
    }
    return parsed.data
}
