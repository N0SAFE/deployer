import { is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'

import {
    decryptSecret,
    encryptSecret,
    isSealedValue,
    SEALED_VALUE_PREFIX,
} from './codec-registry'

/**
 * Re-encrypt every `encryptedText` value that is still in the legacy form (SEC-016).
 *
 * WHY A SWEEP AND NOT "LAZY ON READ": a column codec only sees a value on the way in or out
 * and cannot write back, so old rows would stay legacy forever. The operator runs this once
 * (dry-run first); when it reports zero remaining legacy rows the legacy read path can be
 * deleted. It is idempotent and safe to re-run or interrupt: every row is rewritten with a
 * compare-and-set on the value that was read, so a concurrent write is never overwritten.
 *
 * Values are NEVER logged or put in the report; only table, column and primary key.
 */

export type EncryptedColumnTarget = {
    /** SQL schema, when the table is not in the default one. */
    readonly schema?: string
    readonly table: string
    readonly column: string
    readonly primaryKey: string
}

export type SkippedColumn = {
    readonly table: string
    readonly column: string
    readonly reason: string
}

export type UnsealedRow = { readonly id: string; readonly value: string }

/** The three database operations the sweep needs. `makePgResealStore` implements them over a pg pool. */
export type ResealStore = {
    /** Rows whose value is non-empty and not sealed, with `id` greater than `afterId`, ordered by id. */
    readUnsealed(
        target: EncryptedColumnTarget,
        afterId: string | null,
        limit: number
    ): Promise<readonly UnsealedRow[]>
    /** Compare-and-set. `true` when the row still held `expected` and was updated. */
    replace(
        target: EncryptedColumnTarget,
        id: string,
        expected: string,
        next: string
    ): Promise<boolean>
    countUnsealed(target: EncryptedColumnTarget): Promise<number>
    /**
     * How many non-empty values sit under each key: the sealed ones by key id (`column:2`), and the rest as `legacy` (the old
     * four-part ciphertext) or `plaintext`. Counts only, never a value.
     */
    countByKey(
        target: EncryptedColumnTarget
    ): Promise<Readonly<Record<string, number>>>
    /** Rows whose value is non-empty and NOT sealed under `kid` (legacy, plaintext, or another generation), after `afterId`. */
    readNotUnderKey(
        target: EncryptedColumnTarget,
        kid: string,
        afterId: string | null,
        limit: number
    ): Promise<readonly UnsealedRow[]>
}

const PROBE = 'probe'

/**
 * Find every `encryptedText` column in a schema module by PROBING it: a column whose write
 * codec changes a plain string into a stored secret is an encrypted column. Probing (rather
 * than a hand-kept list) means a newly added encrypted column is covered automatically.
 *
 * Requires the schema codecs to be configured (`registerSchemaCodecs()`), and de-duplicates
 * tables that several service schemas declare under the same SQL name.
 */
export function findEncryptedColumns(schema: Record<string, unknown>): {
    readonly targets: readonly EncryptedColumnTarget[]
    readonly skipped: readonly SkippedColumn[]
} {
    const targets = new Map<string, EncryptedColumnTarget>()
    const skipped: SkippedColumn[] = []

    for (const value of Object.values(schema)) {
        if (!is(value, PgTable)) continue
        const config = getTableConfig(value)
        for (const column of config.columns) {
            if (
                column.columnType !== 'PgCustomColumn' ||
                column.getSQLType() !== 'text'
            )
                continue
            let probed: unknown
            try {
                probed = column.mapToDriverValue(PROBE)
            } catch {
                continue // a custom text column whose codec is not configured is not ours to sweep
            }
            if (typeof probed !== 'string' || probed === PROBE) continue

            const key = `${config.schema ?? ''}.${config.name}.${column.name}`
            if (targets.has(key)) continue
            const primary = config.columns.filter((c) => c.primary)
            const [pk] = primary
            if (primary.length !== 1 || pk === undefined) {
                skipped.push({
                    table: config.name,
                    column: column.name,
                    reason: 'needs exactly one primary key column',
                })
                continue
            }
            targets.set(key, {
                ...(config.schema === undefined
                    ? {}
                    : { schema: config.schema }),
                table: config.name,
                column: column.name,
                primaryKey: pk.name,
            })
        }
    }
    return { targets: [...targets.values()], skipped }
}

export type ResealOptions = {
    /** Report only; write nothing. */
    readonly dryRun: boolean
    /** Seal values that are neither sealed nor legacy ciphertext (for example pre-backfill plaintext). Default: report them. */
    readonly sealPlaintext?: boolean
    readonly batchSize?: number
}

export type ColumnReport = {
    readonly table: string
    readonly column: string
    readonly scanned: number
    readonly resealed: number
    /** Rows that could not be decrypted (wrong key, tampered). Left untouched. */
    readonly failed: readonly string[]
    /** Rows that are neither sealed nor legacy ciphertext. Left untouched unless `sealPlaintext`. */
    readonly unrecognised: readonly string[]
    /** Rows another writer changed between read and write; picked up by a re-run. */
    readonly conflicts: number
    /** Rows still not sealed after this run (always >= the unrecognised/failed ones). */
    readonly remaining: number
}

export type ResealReport = {
    readonly dryRun: boolean
    readonly columns: readonly ColumnReport[]
    /** Zero means the legacy read path is no longer needed. */
    readonly totalRemaining: number
}

const DEFAULT_BATCH = 200

/** The legacy shape: four `:`-separated segments. Anything else that is not sealed is plaintext or foreign. */
const looksLegacy = (value: string): boolean => value.split(':').length === 4

export async function resealEncryptedColumns(
    store: ResealStore,
    targets: readonly EncryptedColumnTarget[],
    options: ResealOptions
): Promise<ResealReport> {
    const batch = options.batchSize ?? DEFAULT_BATCH
    const columns: ColumnReport[] = []

    for (const target of targets) {
        let scanned = 0
        let resealed = 0
        let conflicts = 0
        const failed: string[] = []
        const unrecognised: string[] = []
        let after: string | null = null

        for (;;) {
            const rows = await store.readUnsealed(target, after, batch)
            if (rows.length === 0) break
            for (const row of rows) {
                scanned++
                after = row.id
                if (isSealedValue(row.value)) continue

                let plaintext: string
                if (looksLegacy(row.value)) {
                    try {
                        plaintext = decryptSecret(row.value)
                    } catch {
                        failed.push(row.id)
                        continue
                    }
                } else if (options.sealPlaintext === true) {
                    plaintext = row.value
                } else {
                    unrecognised.push(row.id)
                    continue
                }
                if (options.dryRun) continue

                const next = encryptSecret(plaintext)
                if (!next.startsWith(SEALED_VALUE_PREFIX)) {
                    throw new Error(
                        'reseal refused: the sealing codec is not configured, so nothing would be upgraded'
                    )
                }
                if (await store.replace(target, row.id, row.value, next))
                    resealed++
                else conflicts++
            }
            if (rows.length < batch) break
        }

        columns.push({
            table: target.table,
            column: target.column,
            scanned,
            resealed,
            failed,
            unrecognised,
            conflicts,
            remaining: await store.countUnsealed(target),
        })
    }

    return {
        dryRun: options.dryRun,
        columns,
        totalRemaining: columns.reduce((sum, c) => sum + c.remaining, 0),
    }
}

export type StoredKeyReport = {
    readonly columns: readonly {
        readonly table: string
        readonly column: string
        readonly byKey: Readonly<Record<string, number>>
    }[]
    /** Every column added up: how many values sit under each key. */
    readonly totals: Readonly<Record<string, number>>
}

/**
 * Where the stored values are, by key: the figure an operator needs before retiring a key generation (SEC-101). A generation
 * with a non-zero total still has rows that only it can open.
 */
export async function countStoredKeys(
    store: ResealStore,
    targets: readonly EncryptedColumnTarget[]
): Promise<StoredKeyReport> {
    const columns: { table: string; column: string; byKey: Record<string, number> }[] = []
    const totals: Record<string, number> = {}
    for (const target of targets) {
        const byKey = { ...(await store.countByKey(target)) }
        columns.push({ table: target.table, column: target.column, byKey })
        for (const [key, count] of Object.entries(byKey)) {
            totals[key] = (totals[key] ?? 0) + count
        }
    }
    return { columns, totals }
}

export type RewriteReport = {
    readonly dryRun: boolean
    readonly kid: string
    readonly columns: readonly {
        readonly table: string
        readonly column: string
        readonly scanned: number
        readonly rewritten: number
        /** Rows that could not be opened (a key that is gone, or a tampered value). Left untouched. */
        readonly failed: readonly string[]
        /** Rows another writer changed between read and write; picked up by a re-run. */
        readonly conflicts: number
    }[]
    /** Rows still not under `kid` after the run. */
    readonly remaining: number
}

const KID = /^[a-z]+:[1-9][0-9]{0,8}$/

/**
 * Rewrites every value that is not sealed under `kid` (the current generation) so it is: older generations, legacy
 * ciphertext. The step between rotating and retiring: once it reports nothing remaining, the earlier generations hold no rows.
 *
 * Opens each value with whatever key it needs (the ring accepts every generation not yet retired) and seals it again with the
 * current one. Compare-and-set, idempotent, safe to interrupt; refuses if the codec would not seal under `kid`, because
 * "rewriting" under another key would only move rows around.
 */
export async function rewriteToKey(
    store: ResealStore,
    targets: readonly EncryptedColumnTarget[],
    options: { readonly kid: string; readonly dryRun: boolean; readonly batchSize?: number }
): Promise<RewriteReport> {
    if (!KID.test(options.kid)) throw new Error(`not a key id: ${options.kid}`)
    const batch = options.batchSize ?? DEFAULT_BATCH
    const columns: RewriteReport['columns'][number][] = []
    let remaining = 0

    for (const target of targets) {
        let scanned = 0
        let rewritten = 0
        let conflicts = 0
        const failed: string[] = []
        let after: string | null = null

        for (;;) {
            const rows = await store.readNotUnderKey(target, options.kid, after, batch)
            if (rows.length === 0) break
            for (const row of rows) {
                scanned++
                after = row.id
                let plaintext: string
                try {
                    plaintext = decryptSecret(row.value)
                } catch {
                    failed.push(row.id)
                    continue
                }
                if (options.dryRun) continue
                const next = encryptSecret(plaintext)
                if (!next.includes(`"kid":"${options.kid}"`)) {
                    throw new Error(
                        `rewrite refused: the codec does not seal under ${options.kid}, so nothing would move`
                    )
                }
                if (await store.replace(target, row.id, row.value, next)) rewritten++
                else conflicts++
            }
            if (rows.length < batch) break
        }

        columns.push({ table: target.table, column: target.column, scanned, rewritten, failed, conflicts })
        // Counted, not read: how many values are under any other key now.
        for (const [key, count] of Object.entries(await store.countByKey(target))) {
            if (key !== options.kid) remaining += count
        }
    }

    return { dryRun: options.dryRun, kid: options.kid, columns, remaining }
}

/** Quote a SQL identifier. The names come from the schema, never from user input; quoting is defence in depth. */
const ident = (name: string): string => `"${name.replaceAll('"', '""')}"`
const qualified = (target: EncryptedColumnTarget): string =>
    target.schema === undefined
        ? ident(target.table)
        : `${ident(target.schema)}.${ident(target.table)}`

const UNSEALED = (column: string): string =>
    `${ident(column)} IS NOT NULL AND ${ident(column)} <> '' AND ${ident(column)} NOT LIKE '${SEALED_VALUE_PREFIX}%'`

/** The minimal slice of a `pg` pool/client the store needs. */
export type PgQueryable = {
    query(
        text: string,
        params?: readonly unknown[]
    ): Promise<{ rows: readonly Record<string, unknown>[] }>
}

/**
 * `ResealStore` over Postgres. Primary keys are compared as text, so uuid, text and integer
 * keys all work with one query shape; ordering by that text gives the keyset pagination.
 */
export function makePgResealStore(pg: PgQueryable): ResealStore {
    return {
        async readUnsealed(target, afterId, limit) {
            const pk = ident(target.primaryKey)
            const { rows } = await pg.query(
                `SELECT ${pk}::text AS id, ${ident(target.column)} AS value FROM ${qualified(target)} ` +
                    `WHERE ${UNSEALED(target.column)} AND ($1::text IS NULL OR ${pk}::text > $1::text) ` +
                    `ORDER BY ${pk}::text LIMIT $2`,
                [afterId, limit]
            )
            return rows.map((row) => ({
                id: String(row.id),
                value: String(row.value),
            }))
        },
        async replace(target, id, expected, next) {
            const { rows } = await pg.query(
                `UPDATE ${qualified(target)} SET ${ident(target.column)} = $1 ` +
                    `WHERE ${ident(target.primaryKey)}::text = $2 AND ${ident(target.column)} = $3 RETURNING 1 AS ok`,
                [next, id, expected]
            )
            return rows.length > 0
        },
        async countByKey(target) {
            const col = ident(target.column)
            const { rows } = await pg.query(
                `SELECT CASE ` +
                    `WHEN ${col} LIKE '${SEALED_VALUE_PREFIX}%' THEN coalesce(substring(${col} from '"kid":"([^"]+)"'), 'sealed-unknown') ` +
                    `WHEN ${col} ~ '^[^:]*:[^:]*:[^:]*:[^:]*$' THEN 'legacy' ` +
                    `ELSE 'plaintext' END AS key, count(*)::int AS n ` +
                    `FROM ${qualified(target)} WHERE ${col} IS NOT NULL AND ${col} <> '' GROUP BY 1`
            )
            return Object.fromEntries(
                rows.map((row) => [String(row.key), Number(row.n)])
            )
        },
        async readNotUnderKey(target, kid, afterId, limit) {
            const pk = ident(target.primaryKey)
            const col = ident(target.column)
            const { rows } = await pg.query(
                `SELECT ${pk}::text AS id, ${col} AS value FROM ${qualified(target)} ` +
                    `WHERE ${col} IS NOT NULL AND ${col} <> '' ` +
                    `AND ${col} NOT LIKE '${SEALED_VALUE_PREFIX}%"kid":"' || $3::text || '"%' ` +
                    `AND ($1::text IS NULL OR ${pk}::text > $1::text) ORDER BY ${pk}::text LIMIT $2`,
                [afterId, limit, kid]
            )
            return rows.map((row) => ({
                id: String(row.id),
                value: String(row.value),
            }))
        },
        async countUnsealed(target) {
            const { rows } = await pg.query(
                `SELECT count(*)::int AS n FROM ${qualified(target)} WHERE ${UNSEALED(target.column)}`
            )
            return Number(rows[0]?.n ?? 0)
        },
    }
}
