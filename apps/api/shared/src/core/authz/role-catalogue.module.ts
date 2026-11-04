import { Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";

import { GlobalDatabaseService } from "../modules/database/services/global-database.service";

import { installRoleSnapshot } from "./role-catalog";
import { loadRoleCatalogue } from "./role-catalogue.loader";

/** How stale a permission snapshot may be before it is reloaded (`SEC-055`, ≤30 s). */
const REFRESH_INTERVAL_MS = 30_000;

/**
 * Keeps this process's authorization snapshot in step with the `roles` table.
 *
 * Loaded once at boot — after the seed, in module order — then every 30 s. A write that changes the catalogue also
 * refreshes directly in the service that owns it (see identity's `RoleService`), so a single replica sees an edit
 * immediately; the interval is what makes a SECOND replica catch up, and what bounds staleness if a `NOTIFY`-style push
 * is added later.
 *
 * A failed read keeps the previous snapshot: a database blip must not turn every permission check into a denial.
 */
@Injectable()
export class RoleCatalogueRefresher implements OnApplicationBootstrap, OnModuleDestroy {
	private readonly logger = new Logger(RoleCatalogueRefresher.name);
	private timer: ReturnType<typeof setInterval> | undefined;

	constructor(@Inject(GlobalDatabaseService) private readonly database: GlobalDatabaseService) {}

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

	/** Read the catalogue now — the write path calls this so an edit is visible before the next tick. */
	async refresh(): Promise<void> {
		try {
			const catalogue = await loadRoleCatalogue(this.database.db);
			installRoleSnapshot(catalogue.epoch, catalogue.roles);
		} catch (error) {
			this.logger.warn(`role catalogue refresh failed, keeping the previous snapshot: ${String(error)}`);
		}
	}
}

/**
 * The catalogue refresher, registered once per process.
 *
 * Imported by every service's root module: the authz gate (`SEC-062`) decides from this snapshot, so a service without
 * it would answer from the code table and refuse every CUSTOM role. The database is a global module, so importing this
 * one only adds the provider.
 */
@Module({
	providers: [RoleCatalogueRefresher],
	exports: [RoleCatalogueRefresher],
})
export class RoleCatalogueModule {}
