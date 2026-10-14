/**
 * The `bun:sqlite` shim must match `bun:sqlite`, not `node:sqlite`.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * The two runtimes disagree on the empty-result value: `bun:sqlite`'s `.get()`
 * returns `null`, `node:sqlite`'s returns `undefined`. That difference is not
 * cosmetic — `bun:sqlite` types `.get()` as `Row | null`, so every caller writes
 * `row !== null`, and under `undefined` those checks INVERT: a missing row reads
 * as a present one, silently.
 *
 * That is exactly how it failed. The local-migration state check
 * (`SELECT 1 FROM local_migrations WHERE name = ?`) reported all 13 migrations as
 * already applied against an EMPTY state table, so the schema was never created
 * and the app died later with `no such table: node_config` — from a module that
 * named neither the shim nor the migration runner.
 *
 * These assertions pin the shim to `bun:sqlite`'s contract so the inversion cannot
 * come back.
 */
import { describe, expect, it } from 'vitest'

import { Database } from '../../vitest-shims/bun-sqlite'

function freshDb(): InstanceType<typeof Database> {
    const db = new Database(':memory:')
    db.run('CREATE TABLE things (id integer primary key, name text)')
    return db
}

describe('bun-sqlite shim: `get()` returns null, not undefined', () => {
    it('returns null when no row matches', () => {
        const db = freshDb()
        const missing = db.query('SELECT 1 FROM things WHERE id = ?').get(999)

        // The load-bearing assertion: `null`, because that is what bun:sqlite
        // returns and what every `!== null` check in the codebase expects.
        expect(missing).toBeNull()
        expect(missing).not.toBeUndefined()
        // The check that was silently inverted in production:
        expect(missing !== null).toBe(false)
    })

    it('returns the row when one matches', () => {
        const db = freshDb()
        db.run('INSERT INTO things (id, name) VALUES (?, ?)', 1, 'one')
        expect(db.query('SELECT name FROM things WHERE id = ?').get(1)).toEqual({ name: 'one' })
    })

    it('behaves the same through prepare()', () => {
        const db = freshDb()
        expect(db.prepare('SELECT 1 FROM things WHERE id = ?').get(999)).toBeNull()
    })

    it('returns an empty array, not null, from all()', () => {
        const db = freshDb()
        expect(db.query('SELECT 1 FROM things WHERE id = ?').all(999)).toEqual([])
    })
})
