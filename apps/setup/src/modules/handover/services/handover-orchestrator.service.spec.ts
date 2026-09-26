import { firstValueFrom, of } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";

import { HandoverOrchestratorService } from "./handover-orchestrator.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import type { ClusterOrchestratorService } from "@/modules/cluster/services/cluster-orchestrator.service";
import type { ApiReadinessWatcherService } from "./api-readiness-watcher.service";
import type { ApiServiceProvisioner } from "./api-service-provisioner.service";
import type { IngressHandoverService } from "./ingress-handover.service";

/**
 * The orchestrator sequences three steps, and the ORDER is a safety property,
 * not an implementation detail (plan §9.3). So the assertions are about the
 * SEQUENCE OF EFFECTS — recorded into one array — rather than about each call in
 * isolation: every individual call is correct in any order, and only the order
 * decides whether the platform has a window with no route.
 *
 * The collaborators are stubs; each has (or needs) its own spec. What is tested
 * here is the composition — above all that `ready` is published LAST, because
 * that is the signal compose gates on.
 */
describe("HandoverOrchestratorService", () => {
  let effects: string[];
  let phases: SetupPhaseService;

  function makeOrchestrator(
    options: {
      ready?: boolean;
      provisionThrows?: Error;
      ingressThrows?: Error;
    } = {},
  ): HandoverOrchestratorService {
    const isReady = options.ready ?? true;

    const provisioner = {
      ensureApi: () => {
        if (options.provisionThrows !== undefined) return Promise.reject(options.provisionThrows);
        effects.push("ensureApi");
        return Promise.resolve({
          kind: "container" as const,
          url: "http://api-dev:3005",
          detail: "dev",
        });
      },
    } as unknown as ApiServiceProvisioner;

    const readiness = {
      waitUntilReady: () => {
        effects.push("waitUntilReady");
        return of(
          isReady
            ? { ready: true as const, reason: "ready" }
            : { ready: false as const, reason: "503" },
        );
      },
    } as unknown as ApiReadinessWatcherService;

    const ingress = {
      pointApiAt: (url: string) => {
        if (options.ingressThrows !== undefined) return Promise.reject(options.ingressThrows);
        effects.push(`pointApiAt:${url}`);
        return Promise.resolve();
      },
      pointSetupAtDonePage: (url: string) => {
        effects.push(`pointSetupAtDonePage:${url}`);
        return Promise.resolve();
      },
    } as unknown as IngressHandoverService;

    // `stream$` is only subscribed in `onApplicationBootstrap`, which is not
    // called here — these tests drive the pipeline through `attempt()`, so the
    // cluster subscription is irrelevant and an empty stream is honest.
    const cluster = { stream$: of() } as unknown as ClusterOrchestratorService;

    return new HandoverOrchestratorService(provisioner, readiness, ingress, phases, cluster);
  }

  /** Trigger once and await the single emitted result. */
  function run(orchestrator: HandoverOrchestratorService) {
    const result = firstValueFrom(orchestrator.stream$);
    orchestrator.attempt();
    return result;
  }

  beforeEach(() => {
    effects = [];
    phases = new SetupPhaseService();
  });

  describe("successful handover", () => {
    it("resolves the API, points the api route, waits, then rewrites the setup route", async () => {
      const result = await run(makeOrchestrator());

      expect(result.ok).toBe(true);
      expect(effects).toEqual([
        "ensureApi",
        "pointApiAt:http://api-dev:3005",
        "waitUntilReady",
        "pointSetupAtDonePage:http://api-dev:3005",
      ]);
    });

    it("points `api.<host>` BEFORE waiting, so the hostname is never unrouted", async () => {
      await run(makeOrchestrator());

      // The route exists from the moment the backend is known. The worst case is
      // then the API's own 503 — truthful and debuggable — rather than a Traefik
      // 404 that reads as a routing misconfiguration.
      expect(effects.indexOf("pointApiAt:http://api-dev:3005")).toBeLessThan(
        effects.indexOf("waitUntilReady"),
      );
    });

    it("publishes `ready` only after BOTH ingress writes succeeded", async () => {
      await run(makeOrchestrator());

      expect(phases.current().phase).toBe("ready");
      expect(phases.current().apiReady).toBe(true);
    });

    it("reports the backend it handed over to", async () => {
      const result = await run(makeOrchestrator());

      expect(result).toEqual({ ok: true, apiBackend: "http://api-dev:3005" });
    });
  });

  describe("failure leaves the platform retryable", () => {
    it("fails the phase when the API never becomes ready, and keeps the wizard reachable", async () => {
      const result = await run(makeOrchestrator({ ready: false }));

      expect(result.ok).toBe(false);
      expect(phases.current().phase).toBe("failed");
      // The setup route is NOT rewritten: there is nothing to hand over to, so
      // `setup.<host>` must keep serving the wizard the operator retries from.
      expect(effects.some((e) => e.startsWith("pointSetupAtDonePage"))).toBe(false);
      // The api route WAS pointed (that is the early-write rule), which is what
      // makes `api.<host>` return a diagnosable 503 while the operator retries.
      expect(effects).toContain("pointApiAt:http://api-dev:3005");
    });

    it("reports the provisioner's error as data instead of throwing", async () => {
      const result = await run(
        makeOrchestrator({
          provisionThrows: new Error("SETUP_MODE=prod requires DEPLOYER_API_IMAGE"),
        }),
      );

      // Data, not an exception: the wizard renders the reason, whereas a thrown
      // error would kill the pipeline and leave the phase stuck on "driving".
      expect(result).toEqual({
        ok: false,
        reason: "SETUP_MODE=prod requires DEPLOYER_API_IMAGE",
      });
      expect(phases.current().phase).toBe("failed");
    });

    it("fails the phase rather than throwing when the ingress write fails", async () => {
      const result = await run(
        makeOrchestrator({ ingressThrows: new Error("EACCES: /app/traefik-configs") }),
      );

      expect(result.ok).toBe(false);
      expect(phases.current().phase).toBe("failed");
    });
  });

  describe("the phase vocabulary matches the work", () => {
    it("reports `driving` while waiting, and only `handover` for the swap", async () => {
      const orchestrator = makeOrchestrator();
      const seen: string[] = [];

      // Subscribe to transitions BEFORE triggering, so every phase the pipeline
      // reports is observed in order.
      const subscription = phases.phase$.subscribe((phase) => seen.push(phase));
      await run(orchestrator);
      subscription.unsubscribe();

      // `handover` must not appear before the API was ready — the type's own
      // doc says it means "the API is green; the ingress is being retargeted",
      // so claiming it while still waiting would misreport the wizard's step.
      expect(seen).toContain("driving");
      expect(seen).toContain("handover");
      expect(seen.indexOf("driving")).toBeLessThan(seen.lastIndexOf("handover"));
      expect(seen.at(-1)).toBe("ready");
    });
  });

  describe("retry", () => {
    it("runs again on a second attempt after a failure", async () => {
      const orchestrator = makeOrchestrator({ ready: false });

      await run(orchestrator);
      expect(phases.current().phase).toBe("failed");

      // A retry clears the sticky failure and re-runs the pipeline. Without
      // this, an operator who fixed the cause could not proceed: `record()`
      // deliberately ignores progress while `failed`.
      phases.reset();
      const result = await run(orchestrator);

      expect(result.ok).toBe(false);
      // Two full passes means the pipeline is re-runnable, not one-shot.
      expect(effects.filter((e) => e === "ensureApi")).toHaveLength(2);
    });
  });
});
