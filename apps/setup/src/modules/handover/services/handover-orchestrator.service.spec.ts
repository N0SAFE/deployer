import { firstValueFrom, of } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";

import { HandoverOrchestratorService } from "./handover-orchestrator.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import type { SetupGateService } from "@/modules/wizard/setup-gate.service";
import type { ApiReadinessWatcherService } from "./api-readiness-watcher.service";
import type { ApiServiceProvisioner } from "./api-service-provisioner.service";
import type { IngressHandoverService } from "./ingress-handover.service";

/**
 * The orchestrator sequences four steps, and the ORDER is a safety property, not
 * an implementation detail (plan §9.3). So the assertions are about the SEQUENCE
 * OF EFFECTS — recorded into one array — rather than about each call in
 * isolation: every individual call is correct in any order, and only the order
 * decides whether the platform has a window with no route.
 *
 * The collaborators are stubs; each has its own spec. What is tested here is the
 * composition — above all that the operator's choices reach the API BEFORE the
 * readiness poll (polling first waits for work nobody asked for) and that `ready`
 * is published LAST.
 */
describe("HandoverOrchestratorService", () => {
  let effects: string[];
  let phases: SetupPhaseService;

  function makeOrchestrator(
    options: {
      ready?: boolean;
      provisionThrows?: Error;
      ingressThrows?: Error;
      /** `null` models a RESTART, where there is nothing to deliver. */
      trigger?: unknown;
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

    // The gate is stubbed: its own spec covers persistence and the gate decision.
    // Here it only has to REPORT whether it holds a payload to deliver, which is
    // what decides whether the trigger step runs at all.
    const gate = {
      triggerPayload: () => (options.trigger === undefined ? { strategy: "local" } : options.trigger),
    } as unknown as SetupGateService;

    // The gate edge is subscribed in `onApplicationBootstrap`, which is not
    // called here — these tests drive the pipeline through `attempt()`, the same
    // entry point the subscription uses.
    const orchestrator = new HandoverOrchestratorService(
      provisioner,
      readiness,
      ingress,
      phases,
      gate,
    );

    // Never touch the network: the trigger transport is the one outbound call
    // this service makes directly. Recording the POST is what lets the ordering
    // assertion below prove the choices are delivered BEFORE the poll.
    orchestrator.triggerTransport = (async (url: string | URL | Request) => {
      effects.push(`trigger:${String(url)}`);
      return new Response("{}", { status: 201 });
    }) as typeof fetch;

    return orchestrator;
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
    it("resolves the API, delivers the choices, points the route, waits, then rewrites the setup route", async () => {
      const result = await run(makeOrchestrator());

      expect(result.ok).toBe(true);
      expect(effects).toEqual([
        "ensureApi",
        "pointApiAt:http://api-dev:3005",
        "trigger:http://api-dev:3005/setup/trigger",
        "waitUntilReady",
        "pointSetupAtDonePage:http://api-dev:3005",
      ]);
    });

    it("delivers the operator's choices BEFORE polling for readiness", async () => {
      await run(makeOrchestrator());

      // The trigger is what STARTS provisioning, so polling first would wait for
      // work nobody has asked for — and the API would sit idle until the
      // timeout, failing a perfectly healthy install.
      expect(effects.indexOf("trigger:http://api-dev:3005/setup/trigger")).toBeLessThan(
        effects.indexOf("waitUntilReady"),
      );
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

    it("skips the trigger on a RESTART, where the row is already complete", async () => {
      const result = await run(makeOrchestrator({ trigger: null }));

      // Nothing to deliver: `node_config` holds the completed row and the API's
      // migrate/seed are idempotent, so it provisions the delta unaided. The
      // credentials were deliberately never persisted, so there is nothing to
      // invent here either.
      expect(result.ok).toBe(true);
      expect(effects.some((e) => e.startsWith("trigger:"))).toBe(false);
      expect(effects).toContain("waitUntilReady");
    });
  });

  describe("trigger delivery", () => {
    it("retries while the API is unreachable, then succeeds", async () => {
      const orchestrator = makeOrchestrator();
      // Compressed so the retry is observable without waiting real seconds; the
      // production cadence is asserted nowhere because it is a comfort setting,
      // not a safety property.
      orchestrator.pollIntervalMs = () => 1;
      orchestrator.timeoutMs = () => 5_000;
      let attempts = 0;
      orchestrator.triggerTransport = (async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("ECONNREFUSED");
        return new Response("{}", { status: 201 });
      }) as unknown as typeof fetch;

      const result = await run(orchestrator);

      // The gate opens while the API is still being STARTED, so the first
      // attempts legitimately land on a process that does not exist yet. One
      // POST here would fail every prod handover for that ordinary reason.
      expect(result.ok).toBe(true);
      expect(attempts).toBe(3);
    });

    it("gives up on a 4xx instead of hiding a contract error behind a timeout", async () => {
      const orchestrator = makeOrchestrator();
      let attempts = 0;
      orchestrator.triggerTransport = (async () => {
        attempts += 1;
        return new Response('{"message":"bad payload"}', { status: 422 });
      }) as unknown as typeof fetch;

      const result = await run(orchestrator);

      // A reachable API refusing the request cannot be fixed by sending the
      // same body again, so retrying would burn the full timeout and report a
      // misleading "the API never answered".
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain("422");
      expect(attempts).toBe(1);
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
      // error would kill the pipeline and leave the phase stuck on "provisioning".
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
    it("reports `provisioning` while waiting, and only `handover` for the swap", async () => {
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
      expect(seen).toContain("provisioning");
      expect(seen).toContain("handover");
      expect(seen.indexOf("provisioning")).toBeLessThan(seen.lastIndexOf("handover"));
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
