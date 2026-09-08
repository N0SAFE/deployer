/**
 * `bun:sqlite` compatibility shim for running vitest under Node.js.
 *
 * The VS Code vitest explorer runs vitest on the Node.js runtime (it cannot
 * spawn Bun), and Node's ESM loader cannot resolve the `bun:` protocol. This
 * shim is wired into the API vitest config ONLY when the current runtime is
 * NOT Bun:
 *
 *   resolve.alias: { "bun:sqlite": "<this file>" }
 *
 * It implements the subset of the `bun:sqlite` `Database` API surface that the
 * API code + `drizzle-orm/bun-sqlite` actually exercise, backed by Node's
 * built-in `node:sqlite` (`DatabaseSync`). Under the Bun runtime the alias is
 * NOT applied, so the native `bun:sqlite` module is used instead.
 *
 * Implemented surface (mirrors runtime usage found in the repo):
 *   - `new Database(path?)`              (defaults to `:memory:`)
 *   - `db.run(sql, ...params)`           -> { changes, lastInsertRowid }
 *   - `db.query(sql)`                    -> { get, all, run, values }
 *   - `db.prepare(sql)`                  -> { get, all, run, values, finalize }
 *   - `db.exec(sql)`
 *   - `db.transaction(fn)`               -> fn with .deferred/.immediate/.exclusive
 *   - `db.close()`
 *
 * Rows are returned as plain objects keyed by column name — identical to how
 * `bun:sqlite` returns them (`PRAGMA journal_mode` -> `{ journal_mode }` …).
 */

type SqlValue = string | number | bigint | null | Uint8Array;
type Row = Record<string, unknown>;
type RunResult = { changes: number | bigint; lastInsertRowid: number | bigint };

interface SqliteStatementLike {
  all(...params: SqlValue[]): Row[];
  get(...params: SqlValue[]): Row | undefined;
  run(...params: SqlValue[]): RunResult;
  columns(): Array<{ name: string }>;
}

interface NodeSqliteDatabaseLike {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatementLike;
  close(): void;
}

function loadNodeSqlite(): { DatabaseSync: new (path?: string) => NodeSqliteDatabaseLike } {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("node:sqlite") as { DatabaseSync: new (path?: string) => NodeSqliteDatabaseLike };
  return mod;
}

function toValues(rows: Row[], columns: Array<{ name: string }>): unknown[][] {
  const keys = columns.map((column) => column.name);
  return rows.map((row) => keys.map((key) => row[key]));
}

/** Result of `db.query(sql)` / `db.prepare(sql)` — mirrors `bun:sqlite`. */
class Statement {
  private readonly raw: SqliteStatementLike;
  private readonly hasValues: boolean;

  constructor(raw: SqliteStatementLike) {
    this.raw = raw;
    this.hasValues = typeof (raw as { values?: unknown }).values === "function";
  }

  all(...params: SqlValue[]): Row[] {
    return this.raw.all(...params);
  }

  get(...params: SqlValue[]): Row | undefined {
    return this.raw.get(...params);
  }

  run(...params: SqlValue[]): RunResult {
    return this.raw.run(...params);
  }

  values(...params: SqlValue[]): unknown[][] {
    if (this.hasValues) {
      return (this.raw as SqliteStatementLike & { values(...p: SqlValue[]): unknown[][] }).values(...params);
    }
    return toValues(this.raw.all(...params), this.raw.columns());
  }

  /** No-op — Node statements are not finalizable like bun's. */
  finalize(): void {
    /* no-op */
  }
}

/** `bun:sqlite`-compatible `Database` backed by `node:sqlite`. */
export class Database {
  private readonly db: NodeSqliteDatabaseLike;
  readonly path: string;

  constructor(path: string | null = null) {
    const { DatabaseSync } = loadNodeSqlite();
    const resolved = path ?? ":memory:";
    this.path = resolved;
    this.db = new DatabaseSync(resolved);
  }

  run(sql: string, ...params: SqlValue[]): RunResult {
    return this.prepare(sql).run(...params);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  prepare(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  query(sql: string): Statement {
    return new Statement(this.db.prepare(sql));
  }

  transaction<T>(fn: () => T): (() => T) & {
    deferred: () => T;
    immediate: () => T;
    exclusive: () => T;
  } {
    const run = (mode: "deferred" | "immediate" | "exclusive"): T => {
      const begin =
        mode === "immediate" ? "BEGIN IMMEDIATE" : mode === "exclusive" ? "BEGIN EXCLUSIVE" : "BEGIN";
      this.db.exec(begin);
      try {
        const result = fn();
        this.db.exec("COMMIT");
        return result;
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    };

    const txn = (() => run("deferred")) as (() => T) & {
      deferred: () => T;
      immediate: () => T;
      exclusive: () => T;
    };
    txn.deferred = () => run("deferred");
    txn.immediate = () => run("immediate");
    txn.exclusive = () => run("exclusive");
    return txn;
  }

  close(): void {
    this.db.close();
  }
}

/** Alias kept for callers importing `Database as BunSqliteDatabase`. */
export type StatementSync = Statement;
