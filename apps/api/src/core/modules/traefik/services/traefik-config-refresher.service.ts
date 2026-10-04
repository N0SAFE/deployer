/**
 * TraefikConfigRefresher — fire-and-forget CONFIG update for the live Traefik
 * instance, owned by the traefik CORE module.
 *
 * The operator model:
 *   - config updates → the traefik core module (this refresher + the platform
 *     config service writes the dynamic files; Traefik's file provider reloads
 *     them — no container restart needed),
 *   - process → the SupervisorOrchestratorService re-converges the Traefik
 *     supervisor (only needed when the entry port changed, the container
 *     degraded, etc. — convergeNow is a cheap no-op when healthy).
 *
 * Callers (reachability controller, deployment service, the web-app toggle,
 * boot) never await the result — a failure is logged and surfaces through the
 * supervisor health.
 */

import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";

import { TraefikPlatformConfigService } from "./traefik-platform-config.service";
import { SupervisorOrchestratorService } from "@repo/nest-supervisor-core/supervisor-orchestrator.service";
import { TraefikSupervisorService } from "../../supervisors/platform/traefik-supervisor.service";

@Injectable()
export class TraefikConfigRefresher implements OnApplicationBootstrap, OnModuleDestroy {
	private readonly logger = new Logger(TraefikConfigRefresher.name);

	/**
	 * Backoff for a config write that failed because the DB is not ready yet.
	 *
	 * ── WHY A RETRY IS MANDATORY, NOT POLITE ─────────────────────────────────
	 * The API boots BEFORE setup provisions the database — that is the designed
	 * order, since provisioning is what the wizard's trigger causes and the API
	 * has to be up to receive it. So the boot-time write ALWAYS loses this race on
	 * a fresh install and fails with:
	 *
	 *   [TraefikConfigRefresher] Publishing platform ingress routes at boot
	 *   [TraefikConfigRefresher] Traefik config write failed: Failed query: insert
	 *     into "app_config" ...
	 *
	 * and nothing ever retried it. The consequence was that `dynamic-web.yml` was
	 * NEVER written on a fresh install — real, observed state on a completed
	 * setup:
	 *
	 *   $ ls /config
	 *   dynamic-api.yml  dynamic-setup.yml      <- no dynamic-web.yml
	 *
	 * so `web.<host>` had no router at all and the dashboard 404'd on an ingress
	 * with nothing in its log to explain why. The managed web app was running
	 * perfectly and simply unreachable.
	 *
	 * Retrying is what makes the boot-time attempt meaningful: the write is
	 * idempotent, so re-running it once the schema exists publishes the missing
	 * family with no other coordination.
	 */
	private static readonly RETRY_INTERVAL_MS = 3_000;

	private retryTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	constructor(
		private readonly configService: TraefikPlatformConfigService,
		private readonly orchestrator: SupervisorOrchestratorService,
	) {}

	/**
	 * Write the platform routes ONCE at boot.
	 *
	 * ── WHY THIS IS NEEDED ──────────────────────────────────────────────────
	 * `refresh()` was only ever called from OPERATOR ACTIONS (the web-app
	 * toggle, a deployment, a reachability re-check). Nothing wrote the platform
	 * routes on a fresh install, so `dynamic-web.yml` did not exist until an
	 * operator happened to toggle something:
	 *
	 *   $ ls /config/
	 *   dynamic-api.yml      <- written by the setup handover
	 *   dynamic-setup.yml    <- written by the setup handover
	 *
	 * The consequence was that `web.<host>` had NO router at all — not a wrong
	 * backend, no rule — so the dashboard 404'd on the ingress with nothing in
	 * the Traefik log to explain it, on every freshly onboarded node.
	 *
	 * Boot is the right moment: by the time this runs the platform has a
	 * hostname policy to publish, and the write is idempotent, so a restart
	 * simply re-publishes the same files.
	 */
	onApplicationBootstrap(): void {
		this.logger.log("Publishing platform ingress routes at boot");
		this.refresh();
	}

	/** Rewrite the instance config, then re-converge the process. Never throws. */
	refresh(): void {
		const traefikId = TraefikSupervisorService.getIdentifier();
		void (async () => {
			let wrote = false;
			try {
				await this.configService.writePlatformConfigs();
				wrote = true;
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				// Expected on a fresh install: the schema does not exist yet. Kept at
				// `log` (not `warn`) so a normal boot does not look like a fault, and
				// the retry below is what actually resolves it.
				this.logger.log(
					`Platform config not writable yet (${reason}) — retrying until the global database is ready`,
				);
				this.scheduleRetry();
			}
			try {
				const state = await this.orchestrator.convergeNow(traefikId);
				if (state !== null && state === "degraded") {
					this.logger.warn(`Traefik process DEGRADED after config refresh — see supervisor health`);
				}
			} catch (error) {
				this.logger.warn(`Traefik re-converge failed: ${error instanceof Error ? error.message : String(error)}`);
			}
			if (wrote) this.cancelRetry();
		})();
	}

	/**
	 * Retry the write until it lands.
	 *
	 * Chained timers rather than `setInterval`, so a slow write cannot stack
	 * passes — the same pattern the other cadences in this platform use. Bounded
	 * only by the process lifetime: the schema either appears (setup succeeded) or
	 * the node never becomes usable, in which case a permanently-missing web route
	 * is the least of it, and the log line says exactly what is missing.
	 */
	private scheduleRetry(): void {
		if (this.disposed || this.retryTimer !== null) return;
		this.retryTimer = setTimeout(() => {
			this.retryTimer = null;
			this.refresh();
		}, TraefikConfigRefresher.RETRY_INTERVAL_MS);
	}

	private cancelRetry(): void {
		if (this.retryTimer === null) return;
		clearTimeout(this.retryTimer);
		this.retryTimer = null;
	}

	onModuleDestroy(): void {
		this.disposed = true;
		this.cancelRetry();
	}
}