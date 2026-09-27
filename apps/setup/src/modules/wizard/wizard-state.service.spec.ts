import { describe, expect, it, vi } from "vitest";

import { WizardStateService } from "./wizard-state.service";
import type { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";

/**
 * These are the wizard's PRE-GATE reads — the first thing its first render asks
 * for, at a moment when the API does not exist yet by design. So the assertions
 * are about the three outcomes being distinguishable and consistent:
 *
 *   no row            → show the wizard
 *   row, no URL       → show the wizard (a stale/partial write)
 *   row + URL         → the platform is up; the wizard is not needed
 *
 * The middle case is the one that matters most: reporting `completed` there would
 * hand the operator a dashboard over a schema that was never migrated, and
 * reporting `not_started` for a genuinely complete node would re-run onboarding
 * on a working platform.
 */
function makeService(row: Record<string, unknown> | null) {
  const repo = { find: vi.fn(() => row) };
  return new WizardStateService(repo as unknown as NodeConfigRepository);
}

describe("WizardStateService", () => {
  describe("a fresh node", () => {
    it("reports not started, so the wizard runs", () => {
      const service = makeService(null);

      expect(service.getState()).toMatchObject({
        state: "not_started",
        needsSetup: true,
        currentStep: "choose_strategy",
        progressPercent: 0,
      });
      expect(service.isConfigured()).toBe(false);
    });

    it("offers both bootstrap strategies", () => {
      // The wizard renders strategy selection from this list; returning only
      // "local" would silently remove the fleet-join path from the UI.
      expect(makeService(null).getState().availableStrategies).toEqual(["local", "remote"]);
    });

    it("reports a null node identity rather than inventing one", () => {
      expect(makeService(null).getNodeStatus()).toMatchObject({
        isConfigured: false,
        nodeId: null,
        strategy: null,
      });
    });
  });

  describe("a node with a databaseUrl but no configuredAt", () => {
    const partial = {
      nodeId: "11111111-1111-4111-8111-111111111111",
      strategy: "local",
      databaseUrl: "postgresql://u:p@db:5432/deployer",
      configuredAt: null,
      meshUrlsSnapshot: [],
    };

    it("still reports not started — a partial write is not a completed setup", () => {
      const service = makeService(partial);

      // `configuredAt` is written LAST, after migrate + seed + admin. A row
      // carrying only a URL is an interrupted attempt: showing the dashboard
      // here would present a platform with an empty schema.
      expect(service.isConfigured()).toBe(false);
      expect(service.getState()).toMatchObject({ state: "not_started", needsSetup: true });
    });

    it("exposes the candidate URL's absence through isConfigured, not the URL itself", () => {
      // The status must not leak the connection string — this endpoint is
      // pre-auth and reachable on the platform hostname.
      const status = makeService(partial).getNodeStatus();

      expect(JSON.stringify(status)).not.toContain("postgresql://");
    });
  });

  describe("a completed node", () => {
    const completed = {
      nodeId: "22222222-2222-4222-8222-222222222222",
      strategy: "local",
      databaseUrl: "postgresql://u:p@db:5432/deployer",
      configuredAt: "2026-09-27T18:00:00.000Z",
      meshUrlsSnapshot: ["http://peer:3005"],
    };

    it("reports completed, so the wizard is skipped", () => {
      const service = makeService(completed);

      expect(service.getState()).toMatchObject({
        state: "completed",
        needsSetup: false,
        progressPercent: 100,
        bootstrapStrategy: "local",
      });
    });

    it("derives `completedAt` as a Date from the stored ISO string", () => {
      // The contract types this as `z.date()`, so returning the raw string would
      // fail the wizard's own parse and blank the page.
      const state = makeService(completed).getState();

      expect(state.completedAt).toBeInstanceOf(Date);
      expect(state.completedAt?.toISOString()).toBe("2026-09-27T18:00:00.000Z");
    });

    it("reports the node identity, so the wizard can display it", () => {
      expect(makeService(completed).getNodeStatus()).toMatchObject({
        isConfigured: true,
        nodeId: "22222222-2222-4222-8222-222222222222",
        meshUrlsSnapshot: ["http://peer:3005"],
      });
    });

    it("keeps getState and getNodeStatus in agreement", () => {
      // A divergence would render the wizard AND the done page at once: one
      // endpoint saying "needs setup" while the other says "already done". Both
      // derive from the same predicate, and this is what pins that down.
      const service = makeService(completed);

      expect(service.getState().needsSetup).toBe(false);
      expect(service.getNodeStatus().isConfigured).toBe(true);
    });
  });

  describe("describe()", () => {
    it("names the node when configured, and the missing work when not", () => {
      expect(makeService(null).describe()).toContain("not configured");
      expect(
        makeService({
          nodeId: "33333333-3333-4333-8333-333333333333",
          databaseUrl: "postgresql://u:p@db:5432/deployer",
          configuredAt: "2026-09-27T18:00:00.000Z",
          meshUrlsSnapshot: [],
        }).describe(),
      ).toContain("33333333");
    });
  });
});
