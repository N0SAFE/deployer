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
 * `WizardUpstreamService` is stubbed here: its own job (resolving the base URL
 * and normalizing it) is not what this service decides, and reaching the network
 * would make the spec depend on a running API.
 */
function makeWatcher(responses: Array<{ status: number }>): {
  watcher: ApiReadinessWatcherService;
  calls: () => number;
} {
  let index = 0;
  let calls = 0;

  const upstream = {
    forward: () => {
      calls += 1;
      // Hold the LAST response once the list is exhausted, so a test that polls
      // past its scripted answers sees a stable state rather than `undefined`.
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return Promise.resolve(new Response(null, { status: response?.status ?? 503 }));
    },
  } as unknown as WizardUpstreamService;

  return { watcher: new ApiReadinessWatcherService(upstream), calls: () => calls };
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
  });

  describe("waitUntilReady", () => {
    it("emits the FIRST ready result and stops polling", async () => {
      const { watcher, calls } = makeWatcher([
        { status: 503 },
        { status: 503 },
        { status: 200 },
        { status: 200 },
      ]);

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
