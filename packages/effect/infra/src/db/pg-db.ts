import { Context, Data, Effect, Exit } from "effect";

/** A database call failed; wraps the driver error. Never a client-facing refusal. */
export class DbError extends Data.TaggedError("DbError")<{ readonly cause: unknown }> {}

/** The slice of a `pg` client this module uses, so the package needs no driver dependency. */
export type PgClientLike = {
	query(sql: string, params?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
	release(destroy?: boolean | Error): void;
	/** Set by `pg` once the connection has started; read instead of asking the server. */
	readonly processID?: number | null;
};

/** The slice of a `pg` pool this module uses. */
export type PgPoolLike = {
	connect(): Promise<PgClientLike>;
	query(sql: string, params?: readonly unknown[]): Promise<{ readonly rows: readonly Record<string, unknown>[] }>;
};

export type DbShape<D> = {
	/**
	 * Run a Drizzle callback. Inside `transaction` it runs on the transaction's connection, otherwise on
	 * one borrowed for the call. Interrupting the fiber aborts `signal` AND cancels the query on the
	 * server (`pg_cancel_backend`), so abandoned work does not keep running.
	 */
	readonly use: <A>(fn: (db: D, signal: AbortSignal) => Promise<A>) => Effect.Effect<A, DbError>;
	/**
	 * Run `effect` in ONE transaction on ONE dedicated connection: COMMIT on success, ROLLBACK on
	 * failure or interruption. Nested inside a transaction it becomes a SAVEPOINT.
	 */
	readonly transaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | DbError, R>;
};

export type PgDbOptions<D> = {
	/** Names the transaction context, so two databases in one process never share a transaction. */
	readonly name: string;
	readonly pool: PgPoolLike;
	/** Wrap a connection in the query builder (for Drizzle: `drizzle(client, { schema })`). */
	readonly makeDb: (client: PgClientLike) => D;
};

type Tx<D> = { readonly client: PgClientLike; readonly pid: number | null; readonly db: D; readonly depth: number };

/**
 * A Postgres database as an Effect service: fiber-scoped transactions and server-side cancellation.
 *
 * node-postgres has no per-query abort that stops work on the server, so every connection this
 * module holds remembers its backend pid; on interruption the pid is cancelled from a different
 * pool connection and the interrupted connection is destroyed rather than returned to the pool.
 */
export function makePgDb<D>(options: PgDbOptions<D>): DbShape<D> {
	const { pool, makeDb } = options;
	const CurrentTx = Context.Reference<Tx<D> | undefined>(`${options.name}/CurrentTx`, {
		defaultValue: () => undefined,
	});

	const pidOf = async (client: PgClientLike): Promise<number | null> => {
		if (typeof client.processID === "number") return client.processID;
		const result = await client.query("select pg_backend_pid() as pid");
		const pid = result.rows[0]?.pid;
		return typeof pid === "number" ? pid : null;
	};

	const connect = Effect.tryPromise({
		try: async () => {
			const client = await pool.connect();
			try {
				return { client, pid: await pidOf(client) };
			} catch (cause) {
				client.release(true);
				throw cause;
			}
		},
		catch: (cause) => new DbError({ cause }),
	});

	/** Stop whatever the backend is running, from a different connection. Best effort. */
	const cancelBackend = (pid: number | null) =>
		pid === null
			? Effect.void
			: Effect.ignore(Effect.promise(() => pool.query("select pg_cancel_backend($1)", [pid])));

	const run = <A>(client: PgClientLike, fn: (db: D, signal: AbortSignal) => Promise<A>) =>
		Effect.tryPromise({
			try: (signal) => fn(makeDb(client), signal),
			catch: (cause) => new DbError({ cause }),
		});

	const statement = (client: PgClientLike, sql: string) =>
		Effect.tryPromise({ try: () => client.query(sql), catch: (cause) => new DbError({ cause }) });

	const use: DbShape<D>["use"] = (fn) =>
		Effect.gen(function* () {
			const tx = yield* CurrentTx;
			if (tx !== undefined) return yield* run(tx.client, fn);

			return yield* Effect.acquireUseRelease(
				connect,
				({ client, pid }) => run(client, fn).pipe(Effect.onInterrupt(() => cancelBackend(pid))),
				({ client }, exit) =>
					Effect.sync(() => {
						client.release(!Exit.isSuccess(exit));
					}),
			);
		});

	const transaction: DbShape<D>["transaction"] = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.gen(function* () {
			const outer = yield* CurrentTx;

			if (outer !== undefined) {
				const savepoint = `sp_${String(outer.depth + 1)}`;
				const inner: Tx<D> = { ...outer, depth: outer.depth + 1 };
				return yield* statement(outer.client, `savepoint ${savepoint}`).pipe(
					Effect.andThen(effect.pipe(Effect.provideService(CurrentTx, inner))),
					Effect.tap(() => statement(outer.client, `release savepoint ${savepoint}`)),
					Effect.onError(() => Effect.ignore(statement(outer.client, `rollback to savepoint ${savepoint}`))),
				);
			}

			return yield* Effect.acquireUseRelease(
				connect,
				({ client, pid }) => {
					const tx: Tx<D> = { client, pid, db: makeDb(client), depth: 0 };
					return statement(client, "begin").pipe(
						Effect.andThen(effect.pipe(Effect.provideService(CurrentTx, tx))),
						Effect.tap(() => statement(client, "commit")),
						// Failure or interruption: stop any running statement, then roll back.
						Effect.onError(() => cancelBackend(pid).pipe(Effect.andThen(Effect.ignore(statement(client, "rollback"))))),
					);
				},
				// A connection that ended in failure or interruption may be mid-statement: destroy it.
				({ client }, exit) =>
					Effect.sync(() => {
						client.release(!Exit.isSuccess(exit));
					}),
			);
		});

	return { use, transaction };
}

/** A `DbShape` that reads its pool from the Effect context (`R`) when a call runs. */
export type LazyDbShape<D, R> = {
	readonly use: <A>(fn: (db: D, signal: AbortSignal) => Promise<A>) => Effect.Effect<A, DbError, R>;
	readonly transaction: <A, E, R2>(effect: Effect.Effect<A, E, R2>) => Effect.Effect<A, E | DbError, R2 | R>;
};

/**
 * A Postgres database that is a constant: the source of the pool (a port tag) is yielded when a call
 * runs, and one `makePgDb` handle is built per pool and reused, so every call over the same pool shares
 * its transaction context. Nothing is built at the root and no factory is injected.
 */
export function lazyPgDb<D, S, R>(
	source: Effect.Effect<S, never, R>,
	options: {
		readonly name: string;
		readonly pool: (source: S) => PgPoolLike;
		readonly makeDb: (source: S) => (client: PgClientLike) => D;
	},
): LazyDbShape<D, R> {
	const handles = new WeakMap<object, DbShape<D>>();
	const handleFor = (resolved: S): DbShape<D> => {
		const pool = options.pool(resolved);
		let handle = handles.get(pool);
		if (handle === undefined) {
			handle = makePgDb<D>({ name: options.name, pool, makeDb: options.makeDb(resolved) });
			handles.set(pool, handle);
		}
		return handle;
	};

	return {
		use: (fn) => Effect.flatMap(source, (resolved) => handleFor(resolved).use(fn)),
		transaction: (effect) => Effect.flatMap(source, (resolved) => handleFor(resolved).transaction(effect)),
	};
}
