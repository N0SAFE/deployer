/**
 * NodeConfigSnapshot — the last known node config, readable synchronously.
 *
 * The reader is I/O now (`NodeConfigRepository` asks the node's agent first and only then the local
 * SQLite file), but two seams cannot wait for it:
 *
 *   - the `pg.Pool` built by `GlobalDatabaseModule` resolves its connection string per connect,
 *     inside `pg`'s own synchronous `Client` constructor;
 *   - the global-db supervisor receives its `provisioning` / `databaseUrl` as plain synchronous
 *     callbacks (`@deployer/platform-supervisors` contract).
 *
 * So the value is loaded once at init and refreshed on a timer; both seams read this cache instead of
 * doing a synchronous round trip through an async repository.
 */
import { Context, Effect } from "effect";

import { NodeConfigRepository, type NodeConfigRepositoryShape, type NodeConfigRow } from "@deployer/node-state";
import type { ServiceLifecycleShape } from "@deployer/nest-effect";

const REFRESH_INTERVAL_MS = 30_000;

export type NodeConfigSnapshotShape = ServiceLifecycleShape & {
	/** The last loaded row, or null before the first successful refresh. Synchronous by design. */
	readonly current: () => NodeConfigRow | null;
	/** Reload the row and resolve it; a failure is logged and keeps the previous value (a stale URL is better than none). */
	readonly refresh: () => Effect.Effect<NodeConfigRow | null>;
};

export function makeNodeConfigSnapshot(
	nodeConfig: Pick<NodeConfigRepositoryShape, "find">,
	options: { readonly refreshIntervalMs: number } = { refreshIntervalMs: REFRESH_INTERVAL_MS },
): NodeConfigSnapshotShape {
	let row: NodeConfigRow | null = null;

	const refresh: NodeConfigSnapshotShape["refresh"] = () =>
		nodeConfig.find().pipe(
			Effect.map((found) => {
				row = found;
			}),
			Effect.catch((error: unknown) =>
				Effect.logWarning(`Node config refresh failed, keeping the previous value: ${error instanceof Error ? error.message : String(error)}`),
			),
			Effect.map(() => row),
		);

	return {
		current: () => row,
		refresh,
		onStart: () => Effect.asVoid(refresh()),
		// The runner owns the fiber and interrupts it at shutdown, so the cache never holds the process open.
		run: () =>
			Effect.forever(Effect.sleep(options.refreshIntervalMs).pipe(Effect.andThen(refresh()))),
	};
}

export class NodeConfigSnapshot extends Context.Service<NodeConfigSnapshot, NodeConfigSnapshotShape>()("shared/NodeConfigSnapshot") {
	static readonly provider = {
		provide: NodeConfigSnapshot,
		useFactory: (nodeConfig: NodeConfigRepositoryShape) => makeNodeConfigSnapshot(nodeConfig),
		inject: [NodeConfigRepository],
	};
}
