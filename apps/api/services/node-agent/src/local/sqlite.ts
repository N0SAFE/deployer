/** The part of a SQLite handle the agent's store uses. `bun:sqlite` and `node:sqlite` both have exactly this shape. */
export type SqliteHandle = {
    readonly exec: (sql: string) => void
    readonly prepare: (sql: string) => {
        readonly run: (...params: unknown[]) => unknown
        readonly get: (...params: unknown[]) => unknown
        readonly all: (...params: unknown[]) => unknown[]
    }
    readonly close: () => void
}

type SqliteDriver = new (path: string) => SqliteHandle

/**
 * The pragmas the store always runs with.
 *
 * WAL lets a reader (a status call) proceed while gossip writes, and keeps the writer from blocking on the reader. The
 * busy timeout turns a lost lock race into a 5 s wait instead of an immediate `SQLITE_BUSY`. `synchronous=NORMAL` is the
 * WAL default that does not fsync on every commit: a crash can lose the last commit, never corrupt the file.
 */
const PRAGMAS = [
    'PRAGMA journal_mode=WAL',
    'PRAGMA busy_timeout=5000',
    'PRAGMA synchronous=NORMAL',
] as const

/**
 * Opens the node's SQLite file with the driver the runtime has: `bun:sqlite` under Bun (how the agent runs) and
 * `node:sqlite` under Node (how the tests run). Imported lazily by specifier so neither runtime ever resolves the
 * other's module.
 */
export async function openSqlite(path: string): Promise<SqliteHandle> {
    const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
    const driver = isBun
        ? (
              (await import(/* @vite-ignore */ 'bun:sqlite')) as unknown as {
                  Database: SqliteDriver
              }
          ).Database
        : (
              (await import(/* @vite-ignore */ 'node:sqlite')) as unknown as {
                  DatabaseSync: SqliteDriver
              }
          ).DatabaseSync
    const handle = new driver(path)
    for (const pragma of PRAGMAS) {
        handle.exec(pragma)
    }
    return handle
}
