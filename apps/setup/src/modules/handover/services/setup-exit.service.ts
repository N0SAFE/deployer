import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { Subject, Subscription, firstValueFrom, takeUntil } from "rxjs";

import { SetupPhaseService } from "@/modules/health/setup-phase.service";

/**
 * Decides WHEN the setup app is finished and may stop.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * Setup is a one-way app: it exists to get the platform onto a cluster and then
 * get out of the way (plan §1). Leaving it running would mean two processes
 * permanently fighting over the same hostname, and the operator could re-enter
 * the wizard on a platform that is already serving traffic.
 *
 * ── WHY THE DECISION LIVES HERE AND THE MECHANISM IN `main.ts` ──────────────
 * "When" is this app's business rule: the handover published `ready`, which
 * means the API is green AND both ingress files are correct. "How" (close the
 * container, flush logs, set the exit code) is a process-lifecycle concern that
 * belongs to the entry point. Splitting them means this service is testable
 * without spawning processes, and `main.ts` stays free of platform policy.
 *
 * ── WHY ONLY ON `ready`, NEVER ON `failed` ──────────────────────────────────
 * A failed setup MUST NOT exit. The plan requires a failed onboarding to stay
 * retryable (§10.4): the container keeps serving the wizard, `/setup/health`
 * reports `failed` with a reason, and the operator fixes the cause and retries.
 * Exiting on failure would leave a dead container and no surface to retry from —
 * and the healthcheck would never turn green, so the platform would never start.
 */
@Injectable()
export class SetupExitService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SetupExitService.name);

  /**
   * Fires once the handover is complete, carrying the grace period that must
   * elapse before the process actually stops.
   */
  private readonly exitRequested$ = new Subject<void>();

  private readonly destroyed$ = new Subject<void>();
  private readySubscription: Subscription | null = null;

  /**
   * How long to keep serving after publishing `ready`.
   *
   * The phase turns ready the instant the ingress files are written, but two
   * things are still in flight at that moment:
   *
   *   - Traefik is RELOADING (the file provider watches with `watch: true`), so
   *     for a brief window it may still route `setup.<host>` here. Exiting
   *     instantly would drop any request that arrives in that window.
   *   - The wizard's SSE stream to the browser is still open, and the operator
   *     has not yet seen the final state.
   *
   * Two seconds covers a Traefik reload with margin while keeping the platform's
   * startup latency unchanged in human terms.
   */
  private static readonly GRACE_PERIOD_MS = 2_000;

  constructor(private readonly phases: SetupPhaseService) {}

  /**
   * Subscribe before the handover can reach `ready`.
   *
   * `onApplicationBootstrap` rather than the constructor: subscriptions created
   * in a constructor run during dependency resolution, which is before Nest has
   * finished wiring the container — and a phase event published during that
   * window would be missed.
   */
  onApplicationBootstrap(): void {
    this.readySubscription = this.phases
      .onEnter("ready")
      .pipe(takeUntil(this.destroyed$))
      .subscribe(() => {
        this.logger.log(
          `Handover complete — stopping in ${String(SetupExitService.GRACE_PERIOD_MS)}ms ` +
            "(Traefik reload + final stream frames)",
        );
        this.exitRequested$.next();
      });
  }

  onModuleDestroy(): void {
    this.destroyed$.next();
    this.destroyed$.complete();
    this.readySubscription?.unsubscribe();
    this.readySubscription = null;
  }

  /**
   * Resolve once this app should stop, after the grace period.
   *
   * Awaited by `main.ts`, which then closes the Nest application (running
   * shutdown hooks) and exits. Never resolves on a failed setup — that is
   * deliberate: the process must stay alive to serve the retry.
   */
  async waitForExit(): Promise<void> {
    await firstValueFrom(this.exitRequested$);
    await new Promise((resolve) => setTimeout(resolve, SetupExitService.GRACE_PERIOD_MS));
  }
}
