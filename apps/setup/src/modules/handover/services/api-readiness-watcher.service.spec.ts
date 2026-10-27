import { firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";

import { ApiReadinessWatcherService } from "./api-readiness-watcher.service";
import type { WizardUpstreamService } from "@/modules/wizard/wizard-upstream.service";

/**
 * The watcher is the GATE: nothing touches the ingress until it reports ready.
 *
 * The assertions are therefore about two failure modes that are both silent in
 * production:
 *
 *   1. Reporting ready too EARLY — the ingress is pointed at a process that
 *      cannot serve, which the operator experiences as a 502 on
 *      `api.<host>` right after onboarding.
 *   2. Never settling — a stuck wizard with no error, because the stream keeps
 *      polling and the phase never advances.
 *
 * ── WHY THE STUB IS KEYED BY PATH ───────────────────────────────────────────
 * `probe()` asks TWO questions on the services tier (`/health/ready`, then
 * `/health/platform/ready`), so a stub that answers by CALL ORDER cannot express
 * "the BFF is up but its backends are not" — it would hand the tier probe the
 * same 200 the BFF probe just consumed, and the early-ready bug this suite exists
 * to catch would pass.
 *
 * `WizardUpstreamService` is stubbed here: its own job (resolving the base URL
 * and normalizing it) is not what this service decides, and reaching the network
 * would make the spec depend on a running API.
 */
function makeWatcher(
  responses: Array<{ status: number }>,
  options: { tiers?: Array<{ status: number; body?: unknown } | "repeat" | "absent"> } = {},
): {
  watcher: ApiReadinessWatcherService;
  calls: () => number;
  paths: () => string[];
} {
  let index = 0;
  let tierIndex = 0;
  let calls = 0;
  const paths: string[] = [];

  const tiers = options.tiers ?? [{ status: 404 }];

  const upstream = {
    forward: (path: string) => {
      paths.push(path);

      if (path === "/health/platform/ready") {
        const scripted = tiers[Math.min(tierIndex, tiers.length - 1)];
        tierIndex += 1;
        // "absent" models a monolith that has no roll-up endpoint at all.
        if (scripted === undefined || scripted === "absent" || scripted === "repeat") {
          return Promise.resolve(new Response(null, { status: 404 }));
        }
        return Promise.resolve(
          new Response(scripted.body === undefined ? null : JSON.stringify(scripted.body), { status: scripted.status }),
        );
      }

      calls += 1;
      // Hold the LAST response once the list is exhausted, so a test that polls
      // past its scripted answers sees a stable state rather than `undefined`.
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return Promise.resolve(new Response(null, { status: response?.status ?? 503 }));
    },
  } as unknown as WizardUpstreamService;

  return {
    watcher: new ApiReadinessWatcherService(upstream),
    calls: () => calls,
    paths: () => paths,
  };
}

describe("ApiReadinessWatcherService", () => {
  describe("probe", () => {
    it("reports ready on 200", async () => {
      const { watcher } = makeWatcher([{ status: 200 }]);

      await expect(watcher.probe()).resolves.toMatchObject({ ready: true });
    });

    it("reports NOT ready on 503, which is the normal provisioning state", async () => {
      const { watcher } = makeWatcher([{ status: 503 }]);

      // 503 during provisioning is expected progress, not an error: the wizard
      // shows "driving", and the handover waits. Throwing here would abort
      // onboarding on the single most common intermediate state.
      await expect(watcher.probe()).resolves.toMatchObject({ ready: false });
    });

    describe("the microservices tier", () => {
      it("waits for the WHOLE tier, not just the BFF", async () => {
        // The BFF answers its own readiness while its backends are still starting.
        // Reporting ready here is the bug this gate exists for: the ingress would be
        // swapped onto a BFF with nothing behind it, and every console request 502s.
        const { watcher } = makeWatcher(
          [{ status: 200 }],
          { tiers: [{ status: 503, body: { platform: { state: "degraded", services: [] } } }] },
        );

        await expect(watcher.probe()).resolves.toMatchObject({ ready: false });
      });

      it("names the services that are still down, so the operator knows what is pending", async () => {
        const { watcher } = makeWatcher(
          [{ status: 200 }],
          {
            tiers: [
              {
                status: 503,
                body: {
                  platform: {
                    state: "degraded",
                    services: [
                      { name: "health", healthy: true },
                      { name: "project", healthy: false, reason: "not ready (starting or a dependency is down)" },
                      { name: "fleet", healthy: false, reason: "fetch failed" },
                    ],
                  },
                },
              },
            ],
          },
        );

        const result = await watcher.probe();

        expect(result.ready).toBe(false);
        expect(result.reason).toContain("project");
        expect(result.reason).toContain("fleet");
        // The healthy one must NOT be listed: a reason that names everything is a
        // reason that names nothing.
        expect(result.reason).not.toContain("health (");
      });

      it("reports ready only when every service is green", async () => {
        const { watcher } = makeWatcher(
          [{ status: 200 }],
          { tiers: [{ status: 200, body: { platform: { state: "healthy", services: [] } } }] },
        );

        await expect(watcher.probe()).resolves.toMatchObject({ ready: true });
      });

      it("treats a 404 on the roll-up as 'no tier', so a monolith still onboards", async () => {
        // A monolith has no `/health/platform/ready`. Reading its 404 as "not ready"
        // would hang onboarding forever against a perfectly healthy API.
        const { watcher } = makeWatcher([{ status: 200 }], { tiers: ["absent"] });

        await expect(watcher.probe()).resolves.toMatchObject({ ready: true });
      });

      it("does NOT fall through to ready when the roll-up is guarded", async () => {
        // 401 means the endpoint exists but is behind the auth guard. Silently
        // treating it as ready would disable the gate without anyone noticing.
        const { watcher } = makeWatcher([{ status: 200 }], { tiers: [{ status: 401 }] });

        const result = await watcher.probe();

        expect(result.ready).toBe(false);
        expect(result.reason).toContain("AllowAnonymous");
      });

      it("never asks the roll-up before the BFF itself is up", async () => {
        const { watcher, paths } = makeWatcher([{ status: 503 }]);

        await watcher.probe();

        // One question, not two: the tier cannot be green if the BFF is not, and
        // asking anyway doubles the probing on every poll while provisioning.
        expect(paths()).toEqual(["/health/ready"]);
      });
    });
  });

  describe("waitUntilReady", () => {
    it("emits the FIRST ready result and stops polling", async () => {
      const { watcher, calls } = makeWatcher([{ status: 503 }, { status: 503 }, { status: 200 }, { status: 200 }]);

      const result = await firstValueFrom(watcher.waitUntilReady(1, 5_000));

      expect(result).toMatchObject({ ready: true });
      // Stopped at the first 200: a stream that kept polling would let the
      // handover fire repeatedly on its own.
      expect(calls()).toBe(3);
    });

    it("gives up at the deadline instead of polling forever", async () => {
      const { watcher } = makeWatcher([{ status: 503 }]);

      const result = await firstValueFrom(watcher.waitUntilReady(1, 30));

      // Emits a NOT-ready result so the orchestrator can fail the phase with a
      // reason. Completing with nothing would leave the wizard stuck on
      // "driving" with no explanation.
      expect(result).toMatchObject({ ready: false });
    });

    it("treats a probe EXCEPTION as not-ready rather than a fatal error", async () => {
      const upstream = {
        forward: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
      } as unknown as WizardUpstreamService;
      const watcher = new ApiReadinessWatcherService(upstream);

      // A connection refusal is what the API looks like BEFORE it starts, which
      // in prod is the normal first state. The error channel would abort the
      // handover on startup.
      const result = await firstValueFrom(watcher.waitUntilReady(1, 30));

      expect(result).toMatchObject({ ready: false });
    });
  });
});
