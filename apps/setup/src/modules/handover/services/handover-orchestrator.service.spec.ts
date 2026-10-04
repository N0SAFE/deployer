import { firstValueFrom, of } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";

import { HandoverOrchestratorService } from "./handover-orchestrator.service";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import type { BootstrapIngressService } from "@/modules/ingress/services/bootstrap-ingress.service";
import type { SetupGateService } from "@/modules/wizard/setup-gate.service";
import type { WizardStreamService } from "@/modules/wizard/wizard-stream.service";
import { OrchestrationStreamService } from "@/modules/progress/services/orchestration-stream.service";
import { makeEnvService } from "@/test-support/env";
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
      /** `false` models the swarm ingress never claiming the entry port. */
      portReleased?: boolean;
      /** `null` models a RESTART, where there is nothing to deliver. */
      trigger?: unknown;
      /**
       * Whether the operator asked for a dashboard. Drives the web-readiness
       * wait: `false` (the default here) keeps these specs focused on the API
       * handover, since the wait would otherwise poll a real ingress.
       */
      managedWeb?: boolean;
    } = {},
  ): HandoverOrchestratorService {
    const isReady = options.ready ?? true;
    const portReleased = options.portReleased ?? true;

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
      // The dashboard's public hostname — used by the new "wait until the web is
      // ROUTED" step. Present on the real service; the stub must answer so the
      // step's gate (`managedWebEnabled`) is the only thing deciding.
      webHostname: () => "web.deployer.localhost",
    } as unknown as IngressHandoverService;

    // The gate is stubbed: its own spec covers persistence and the gate decision.
    // Here it only has to REPORT whether it holds a payload to deliver (which
    // decides whether the trigger step runs) and whether the operator asked for
    // a dashboard (which decides whether the web-readiness wait runs).
    const gate = {
      triggerPayload: () => (options.trigger === undefined ? { strategy: "local" } : options.trigger),
      managedWebEnabled: () => options.managedWeb === true,
    } as unknown as SetupGateService;

    // The bootstrap ingress is stubbed because it drives the docker engine. What
    // matters here is WHERE its release lands in the sequence — after the API is
    // green, because the entry port is a host port and the swarm incarnation of
    // the ingress can only bind it once the container has let go.
    const bootstrapIngress = {
      releaseEntryPort: () => {
        effects.push("releaseEntryPort");
        return Promise.resolve(portReleased);
      },
    } as unknown as BootstrapIngressService;

    // The gate edge is subscribed in `onApplicationBootstrap`, which is not
    // called here — these tests drive the pipeline through `attempt()`, the same
    // entry point the subscription uses.
    const envService = makeEnvService({ SETUP_MODE: "dev" });

    // The API stream is stubbed: attaching it is a long-running subscription
    // against a process that does not exist in a unit test. What matters here is
    // that it is ATTACHED at the right point in the sequence (after the API
    // answers, before the trigger), which `effects` records.
    const stream = {
      attachWhenReachable: () => {
        effects.push("attachStream");
        return Promise.resolve();
      },
    } as unknown as WizardStreamService;

    const orchestrator = new HandoverOrchestratorService(
      provisioner,
      readiness,
      ingress,
      phases,
      gate,
      bootstrapIngress,
      new OrchestrationStreamService(envService),
      stream,
      envService,
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
    it("resolves the API, attaches its stream, delivers the choices, points the route, waits, then rewrites the setup route", async () => {
      const result = await run(makeOrchestrator());

      expect(result.ok).toBe(true);
      expect(effects).toEqual([
        "ensureApi",
        "pointApiAt:http://api-dev:3005",
        // The API's own output is streamed BEFORE the trigger, so the operator
        // sees provisioning from its FIRST event. Attaching after the trigger
        // would miss the beginning of the run — which is the part that shows the
        // platform coming up.
        "attachStream",
        "trigger:http://api-dev:3005/setup/trigger",
        "waitUntilReady",
        "releaseEntryPort",
        "pointSetupAtDonePage:http://api-dev:3005",
      ]);
    });

    it("attaches the API's stream BEFORE delivering the trigger", async () => {
      await run(makeOrchestrator());

      // Ordering, not presence: the stream must be live when provisioning
      // starts, otherwise the first events are lost and the progress view opens
      // mid-run with no explanation of how it got there.
      expect(effects.indexOf("attachStream")).toBeLessThan(
        effects.indexOf("trigger:http://api-dev:3005/setup/trigger"),
      );
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

    it("releases the entry port AFTER the API is green, never before", async () => {
      await run(makeOrchestrator());

      // The entry port is a HOST port held by the bootstrap ingress container,
      // and the swarm incarnation can only bind it once that container lets go.
      // Releasing BEFORE the API is green would open a window where neither
      // ingress serves — and would do it while the operator may still be
      // watching the wizard.
      expect(effects.indexOf("waitUntilReady")).toBeLessThan(effects.indexOf("releaseEntryPort"));
    });

    it("rewrites the setup route AFTER releasing the port, so the hostname never 404s", async () => {
      await run(makeOrchestrator());

      // Between the release and the swarm task binding, `setup.<host>` must still
      // answer. Rewriting the route first keeps it pointing at a live backend for
      // the whole window (plan §9.2: a URL changes owner, it never disappears).
      expect(effects.indexOf("releaseEntryPort")).toBeLessThan(
        effects.indexOf("pointSetupAtDonePage:http://api-dev:3005"),
      );
    });

    it("fails the handover when the swarm ingress never claims the port", async () => {
      const result = await run(makeOrchestrator({ portReleased: false }));

      // The service restores the bootstrap container in this case, so the
      // platform stays reachable. Reporting success here would tell the operator
      // the platform converged while its ingress is about to stop existing.
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toContain("entry port");
      expect(effects).not.toContain("pointSetupAtDonePage:http://api-dev:3005");
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
