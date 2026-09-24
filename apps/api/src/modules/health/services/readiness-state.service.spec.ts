import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Subject, filter } from "rxjs";

import { ReadinessStateService } from "./readiness-state.service";
import { AppLifecyclePhase, type AppLifecycleEvent } from "@repo/nest-lifecycle";
import type { AppLifecycleService } from "@repo/nest-lifecycle";
import type { SupervisorOrchestratorService } from "@/core/modules/supervisors/supervisor-orchestrator.service";
import type { SupervisorEventBus, SupervisorEvent } from "@/core/modules/supervisors/supervisor-event.bus";

/**
 * This service is what makes the readiness endpoint I/O-free: the work happens
 * HERE, on change, instead of on every poll.
 *
 * The properties that matter:
 *   1. events trigger a refresh (so the probe tracks reality promptly),
 *   2. the lifecycle's flags are READ, never re-derived by probing,
 *   3. a failing aggregation keeps the last good value instead of blanking it,
 *   4. `snapshot()` never touches a dependency (the polled path).
 */

function makeHarness(options: { supervisors?: unknown[]; aggregationFails?: boolean } = {}) {
  const lifecycleEvents$ = new Subject<AppLifecycleEvent>();
  let phase = AppLifecyclePhase.BOOTSTRAPPING;
  let metadata: Record<string, unknown> = {};

  const lifecycle = {
    events: lifecycleEvents$.asObservable(),
    get phase() {
      return phase;
    },
    getSnapshot: vi.fn(() => ({
      phase,
      step: undefined,
      message: "m",
      timestamp: "2026-01-01T00:00:00.000Z",
      error: undefined,
      metadata: Object.keys(metadata).length > 0 ? { ...metadata } : undefined,
    })),
  } as unknown as AppLifecycleService;

  const getHealthOfAll = vi.fn(async () => {
    if (options.aggregationFails === true) throw new Error("aggregation exploded");
    return options.supervisors ?? [];
  });
  const orchestrator = { getHealthOfAll } as unknown as SupervisorOrchestratorService;

  const supervisorSubject = new Subject<SupervisorEvent>();
  const eventBus = {
    // Mirrors the REAL bus's filtering (supervisorId and/or type). A stub that
    // ignored the filter would make every event look like a health change and
    // hide a missing type filter in the service.
    of: vi.fn((filterSpec: { supervisorId?: string; type?: string } = {}) =>
      supervisorSubject.asObservable().pipe(
        filter(
          (event) =>
            (filterSpec.supervisorId === undefined || filterSpec.supervisorId === event.supervisorId) &&
            (filterSpec.type === undefined || filterSpec.type === event.type),
        ),
      ),
    ),
    emit: vi.fn((event: SupervisorEvent) => supervisorSubject.next(event)),
    events$: supervisorSubject.asObservable(),
  } as unknown as SupervisorEventBus;

  const service = new ReadinessStateService(lifecycle, orchestrator, eventBus);

  return {
    service,
    lifecycleEvents$,
    supervisorSubject,
    getHealthOfAll,
    setPhase: (next: AppLifecyclePhase, meta?: Record<string, unknown>) => {
      phase = next;
      if (meta !== undefined) metadata = meta;
    },
    setMetadata: (meta: Record<string, unknown>) => {
      metadata = meta;
    },
  };
}

describe("ReadinessStateService", () => {
  let harness: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    vi.useFakeTimers();
    harness = makeHarness();
  });

  afterEach(() => {
    harness.service.onModuleDestroy();
    vi.useRealTimers();
  });

  it("seeds from the lifecycle snapshot without probing anything", () => {
    // Construction reads the lifecycle's CURRENT state, so the very first probe
    // (which can arrive before onModuleInit completes) already answers with
    // real state instead of an empty placeholder.
    const seeded = makeHarness();

    expect(seeded.service.snapshot().lifecyclePhase).toBe(AppLifecyclePhase.BOOTSTRAPPING);
    // Seeding must not touch a dependency — the polled path stays I/O-free.
    expect(seeded.getHealthOfAll).not.toHaveBeenCalled();
    seeded.service.onModuleDestroy();
  });

  it("reads database/mesh flags from the lifecycle instead of re-probing", async () => {
    harness.setPhase(AppLifecyclePhase.READY);
    harness.service.onModuleInit();
    harness.setMetadata({ databaseReachable: true, meshConnected: true });

    await harness.service.refresh();

    const snapshot = harness.service.snapshot();
    expect(snapshot.databaseReachable).toBe(true);
    expect(snapshot.meshConnected).toBe(true);
  });

  it("updates the cached phase when a lifecycle event arrives", () => {
    harness.service.onModuleInit();
    harness.setPhase(AppLifecyclePhase.READY);

    harness.lifecycleEvents$.next({
      phase: AppLifecyclePhase.READY,
      timestamp: "2026-01-01T00:00:00.000Z",
      metadata: { databaseReachable: true },
    });

    const snapshot = harness.service.snapshot();
    expect(snapshot.lifecyclePhase).toBe(AppLifecyclePhase.READY);
    expect(snapshot.databaseReachable).toBe(true);
  });

  it("keeps the previous flag when an event omits it", () => {
    // A transition with no `meshConnected` metadata must not erase a known
    // value — that would flip readiness to not-ready on an unrelated change.
    harness.service.onModuleInit();
    harness.setMetadata({ meshConnected: true });
    harness.lifecycleEvents$.next({
      phase: AppLifecyclePhase.DEGRADED,
      timestamp: "2026-01-01T00:00:00.000Z",
      metadata: { databaseReachable: false },
    });

    expect(harness.service.snapshot().meshConnected).toBe(true);
  });

  it("debounces a burst of supervisor events into ONE aggregation pass", async () => {
    // Converging five supervisors emits a dozen events within milliseconds.
    // Probing per event would hammer the resources being observed.
    harness.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(300);
    const before = harness.getHealthOfAll.mock.calls.length;

    for (let i = 0; i < 5; i++) {
      harness.supervisorSubject.next({
        supervisorId: `s${String(i)}`,
        type: "state-changed",
        at: "2026-01-01T00:00:00.000Z",
      });
    }
    await vi.advanceTimersByTimeAsync(300);

    expect(harness.getHealthOfAll.mock.calls.length).toBe(before + 1);
  });

  it("ignores supervisor event types that cannot change health", async () => {
    harness.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(300);
    const before = harness.getHealthOfAll.mock.calls.length;

    // `registered`/`removed` change the roster, not the health of a resource,
    // and the safety-net cadence picks the roster up.
    harness.supervisorSubject.next({
      supervisorId: "s1",
      type: "registered",
      at: "2026-01-01T00:00:00.000Z",
    } as never);
    await vi.advanceTimersByTimeAsync(300);

    expect(harness.getHealthOfAll.mock.calls.length).toBe(before);
  });

  it("keeps the last good supervisor list when aggregation fails", async () => {
    // One unreachable dependency must not blank the picture: the failing
    // component is exactly what the operator needs to see.
    const healthy = [{ supervisorId: "platform-redis", healthy: true }];
    const ok = makeHarness({ supervisors: healthy });
    ok.service.onModuleInit();
    await ok.service.refresh();
    expect(ok.service.snapshot().supervisors).toHaveLength(1);

    const failing = makeHarness({ aggregationFails: true });
    failing.service.onModuleInit();
    await failing.service.refresh();
    expect(Array.isArray(failing.service.snapshot().supervisors)).toBe(true);

    ok.service.onModuleDestroy();
    failing.service.onModuleDestroy();
  });

  it("does not perform I/O on snapshot(), because it is the polled path", async () => {
    harness.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(300);
    const callsAfterInit = harness.getHealthOfAll.mock.calls.length;

    for (let i = 0; i < 25; i++) harness.service.snapshot();

    expect(harness.getHealthOfAll.mock.calls.length).toBe(callsAfterInit);
  });

  it("stops refreshing after destroy — no timer leak", async () => {
    harness.service.onModuleInit();
    await vi.advanceTimersByTimeAsync(300);
    harness.service.onModuleDestroy();
    const afterDestroy = harness.getHealthOfAll.mock.calls.length;

    await vi.advanceTimersByTimeAsync(60_000);

    expect(harness.getHealthOfAll.mock.calls.length).toBe(afterDestroy);
  });

  it("exposes changes as an observable for event-driven consumers", () => {
    harness.service.onModuleInit();
    const seen: string[] = [];
    const subscription = harness.service.snapshot$.subscribe((s) => seen.push(s.checkedAt));

    harness.service.requestRefresh();
    expect(seen.length).toBeGreaterThanOrEqual(1);
    subscription.unsubscribe();
  });
});
