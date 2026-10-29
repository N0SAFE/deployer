/** The part of a SQLite handle the agent's store uses. `bun:sqlite` and `node:sqlite` both have exactly this shape. */
export type SqliteHandle = {
  readonly exec: (sql: string) => void;
  readonly prepare: (sql: string) => {
    readonly run: (...params: unknown[]) => unknown;
    readonly get: (...params: unknown[]) => unknown;
    readonly all: (...params: unknown[]) => unknown[];
  };
  readonly close: () => void;
};

type SqliteDriver = new (path: string) => SqliteHandle;

/**
 * Opens the node's SQLite file with the driver the runtime has: `bun:sqlite` under Bun (how the agent runs) and
 * `node:sqlite` under Node (how the tests run). Imported lazily by specifier so neither runtime ever resolves the
 * other's module.
 */
export async function openSqlite(path: string): Promise<SqliteHandle> {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";
  const driver = isBun
    ? ((await import(/* @vite-ignore */ "bun:sqlite")) as unknown as { Database: SqliteDriver }).Database
    : ((await import(/* @vite-ignore */ "node:sqlite")) as unknown as { DatabaseSync: SqliteDriver }).DatabaseSync;
  return new driver(path);
}
