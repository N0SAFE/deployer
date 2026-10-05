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

	/** Watch timer for the post-handover re-publish (see `retryUntilHandoverCompletes`). */
	private handoverTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private readonly configService: TraefikPlatformConfigService,
		private readonly orchestrator: SupervisorOrchestratorService,
	) {}

	/**
	 * Write the platform routes ONCE at boot, then AGAIN once the handover ends.
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
	 *
	 * ── AND WHY BOOT ALONE IS NOT ENOUGH: SETUP WRITES LAST ─────────────────
	 * Setup publishes `dynamic-setup.yml` as its FINAL act — after this API has
	 * already booted — so on every onboarding its version supersedes ours:
	 *
	 *   API boot   12:50:52   writes the API's platform-setup route
	 *   handover   12:51:18   setup overwrites it with its own
	 *
	 * Setup's version has no redirect and names setup's own backend, so
	 * `setup.<host>` kept serving the wizard's router instead of the API's
	 * landing page with its redirect to the console. The observed symptom was a
	 * reload after onboarding landing on a stale target rather than the
	 * dashboard.
	 *
	 * So the boot write is followed by a SECOND one, gated on the handover
	 * having actually finished. `retryUntilHandoverCompletes()` is what observes
	 * that, using the same bounded-retry shape as the DB race above.
	 */
	onApplicationBootstrap(): void {
		this.logger.log("Publishing platform ingress routes at boot");
		this.refresh();
		this.retryUntilHandoverCompletes();
	}

	/**
	 * Re-publish the platform routes once setup has released the entry port.
	 *
	 * ── THE SIGNAL, AND WHY IT IS THE RIGHT ONE ─────────────────────────────
	 * Setup's bootstrap ingress holds the entry port until the handover, and it
	 * is the ONLY thing that writes `dynamic-setup.yml` last. `bootstrapIngress`
	 * on the supervisor payload reports whether that container still exists, so
	 * observing it flip to false means setup has finished — including its final
	 * write. Re-publishing then is what makes the API's version win.
	 *
	 * Polling rather than eventing because the transition is not a docker event
	 * the platform subscribes to, and the cost is one cheap supervisor read per
	 * interval until it flips. Bounded by the process lifetime: on a node whose
	 * onboarding already finished, the very first read is already false.
	 *
	 * Best-effort throughout: a failed read or write must never affect boot, and
	 * the next operator action re-publishes anyway.
	 */
	private retryUntilHandoverCompletes(): void {
		if (this.disposed || this.handoverTimer !== null) return;
		this.handoverTimer = setTimeout(() => {
			this.handoverTimer = null;
			void (async () => {
				try {
					const state = await this.orchestrator.convergeNow(TraefikSupervisorService.getIdentifier());
					// ── ONLY `converged` PROVES THE HANDOVER IS OVER ────────────
					// The supervisor's state space is `idle | converging | converged |
					// degraded | pending | null`, and each of the others means
					// something DIFFERENT for this decision:
					//
					//   `pending`    — deferred on the entry port, i.e. setup still
					//                  owns it. This IS the not-yet case.
					//   `converging` — a pass is in flight; the outcome is unknown.
					//   `idle` / null — the supervisor has not run yet.
					//   `degraded`   — it ran and FAILED, so the ingress is not ours
					//                  to describe; re-publishing now would publish
					//                  routes for a process that is not serving.
					//
					// Treating anything but `pending` as done (the first attempt at
					// this) would fire the re-publish while setup was still mid-flight
					// and let setup's final write win again — the very race being
					// closed. So the condition is positive: converge, THEN re-publish.
					if (state !== "converged") {
						this.retryUntilHandoverCompletes();
						return;
					}
					await this.configService.writePlatformConfigs();
					this.logger.log(
						"Platform routes re-published after the handover — setup's route is superseded",
					);
				} catch (error: unknown) {
					const reason = error instanceof Error ? error.message : String(error);
					this.logger.warn(`Could not re-publish the platform routes after the handover: ${reason}`);
					this.retryUntilHandoverCompletes();
				}
			})();
		}, TraefikConfigRefresher.RETRY_INTERVAL_MS);
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
		if (this.handoverTimer !== null) {
			clearTimeout(this.handoverTimer);
			this.handoverTimer = null;
		}
	}
}