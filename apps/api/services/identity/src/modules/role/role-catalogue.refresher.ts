import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { Effect } from "effect";

import { installRoleSnapshot } from "@identity/core/authz/role-catalog";
import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";

import { RoleRepository } from "./role.repository";

/** How stale a permission snapshot may be before it is reloaded (`SEC-055`, ≤30 s). */
const REFRESH_INTERVAL_MS = 30_000;

/**
 * Keeps the authorization snapshot in step with the `roles` table.
 *
 * Loaded once at boot — after the seed, in module order — then every 30 s. Writes that change the catalogue ALSO refresh
 * directly (see `RoleService`), so a single-replica deployment sees an edit immediately; the interval is what makes a
 * SECOND replica catch up, and what bounds staleness if a `NOTIFY`-style push is added later.
 */
@Injectable()
export class RoleCatalogueRefresher implements OnApplicationBootstrap, OnModuleDestroy {
	private readonly logger = new Logger(RoleCatalogueRefresher.name);
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(@Inject(DatabasePort) private readonly database: DatabaseShape) {}

	async onApplicationBootstrap(): Promise<void> {
		await this.refresh();
		this.timer = setInterval(() => {
			void this.refresh();
		}, REFRESH_INTERVAL_MS);
		// Never keep the process alive for a refresh.
		this.timer.unref();
	}

	onModuleDestroy(): void {
		if (this.timer !== undefined) clearInterval(this.timer);
		this.timer = undefined;
	}

	private async refresh(): Promise<void> {
		try {
			const catalogue = await Effect.runPromise(
				RoleRepository.live
					.loadCatalogue()
					.pipe(Effect.provideService(DatabasePort, this.database)),
			);
			installRoleSnapshot(catalogue.epoch, catalogue.roles);
		} catch (error) {
			// Keep the previous snapshot: a database blip must not turn every permission check into a denial.
			this.logger.warn(`role catalogue refresh failed, keeping the previous snapshot: ${String(error)}`);
		}
	}
}
