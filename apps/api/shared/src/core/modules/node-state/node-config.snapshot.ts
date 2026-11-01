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
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { NodeConfigRepository, type NodeConfigRepositoryShape, type NodeConfigRow } from "@deployer/node-state";

const REFRESH_INTERVAL_MS = 30_000;

@Injectable()
export class NodeConfigSnapshot implements OnModuleInit, OnApplicationShutdown {
	private readonly logger = new Logger(NodeConfigSnapshot.name);
	private row: NodeConfigRow | null = null;
	private timer: ReturnType<typeof setInterval> | null = null;

	constructor(@Inject(NodeConfigRepository) private readonly nodeConfigRepository: NodeConfigRepositoryShape) {}

	/** The last loaded row, or null before the first successful refresh. Synchronous by design. */
	current(): NodeConfigRow | null {
		return this.row;
	}

	/** Reload the row; a failure keeps the previous value (a stale URL is better than none). */
	async refresh(): Promise<NodeConfigRow | null> {
		try {
			this.row = await runPromiseUnwrapped(this.nodeConfigRepository.find());
		} catch (error: unknown) {
			this.logger.warn(`Node config refresh failed, keeping the previous value: ${error instanceof Error ? error.message : String(error)}`);
		}
		return this.row;
	}

	async onModuleInit(): Promise<void> {
		await this.refresh();
		this.timer = setInterval(() => {
			void this.refresh();
		}, REFRESH_INTERVAL_MS);
		// Never hold the event loop open for a cache refresh.
		this.timer.unref?.();
	}

	onApplicationShutdown(): void {
		if (this.timer !== null) clearInterval(this.timer);
		this.timer = null;
	}
}
