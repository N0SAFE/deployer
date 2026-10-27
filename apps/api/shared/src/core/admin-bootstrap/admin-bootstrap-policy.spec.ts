import { describe, expect, it } from "vitest";

import { resolveAdminBootstrapDecision } from "./admin-bootstrap-policy";

/**
 * The admin decision is security-adjacent: it decides whether this boot CREATES
 * an account. So the assertions are about precedence and about the failure
 * direction — an unrecognised value must not silently mean "yes, create one".
 *
 * Inputs are passed as ARGUMENTS rather than through `process.env`: the resolver
 * is pure, and a spec that mutated the environment would leak between cases and
 * make failures order-dependent.
 */
describe("resolveAdminBootstrapDecision", () => {
  describe("the canonical switch wins outright", () => {
    it("honours ADMIN_BOOTSTRAP=true over a disabling alias", () => {
      expect(
        resolveAdminBootstrapDecision({ adminBootstrap: "true", enableDevBootstrap: "false" }),
      ).toMatchObject({ decision: "always" });
    });

    it("honours ADMIN_BOOTSTRAP=false over an enabling alias", () => {
      expect(
        resolveAdminBootstrapDecision({ adminBootstrap: "false", enableDevBootstrap: "true" }),
      ).toMatchObject({ decision: "never" });
    });

    it("treats an unrecognised value as NEVER, not as the default", () => {
      // A typo in this switch must not create an account nobody asked for. The
      // safe direction for a security-adjacent default is "do nothing".
      expect(resolveAdminBootstrapDecision({ adminBootstrap: "yes please" })).toMatchObject({
        decision: "never",
      });
    });
  });

  describe("deprecated aliases, only while the switch is unset", () => {
    it("uses ENABLE_DEV_BOOTSTRAP in development", () => {
      expect(
        resolveAdminBootstrapDecision({ nodeEnv: "development", enableDevBootstrap: "true" }),
      ).toMatchObject({ decision: "always" });

      expect(
        resolveAdminBootstrapDecision({ nodeEnv: "development", enableDevBootstrap: "false" }),
      ).toMatchObject({ decision: "never" });
    });

    it("uses ENABLE_SEEDING in production", () => {
      expect(
        resolveAdminBootstrapDecision({ nodeEnv: "production", enableSeeding: "true" }),
      ).toMatchObject({ decision: "always" });

      expect(
        resolveAdminBootstrapDecision({ nodeEnv: "production", enableSeeding: "false" }),
      ).toMatchObject({ decision: "never" });
    });

    it("does NOT read the dev alias in production, or vice versa", () => {
      // The two aliases come from different eras and different operators; letting
      // the dev one enable seeding in production would be a real privilege bug.
      expect(
        resolveAdminBootstrapDecision({ nodeEnv: "production", enableDevBootstrap: "true" }),
      ).toMatchObject({ decision: "always" });
      expect(
        resolveAdminBootstrapDecision({ nodeEnv: "production", enableDevBootstrap: "true" }).reason,
      ).toContain("default");

      expect(
        resolveAdminBootstrapDecision({ nodeEnv: "development", enableSeeding: "false" }),
      ).toMatchObject({ decision: "always" });
    });

    it("lets `auto` fall through to the aliases and then the default", () => {
      expect(
        resolveAdminBootstrapDecision({ adminBootstrap: "auto", enableDevBootstrap: "false" }),
      ).toMatchObject({ decision: "never" });

      expect(resolveAdminBootstrapDecision({ adminBootstrap: "auto" })).toMatchObject({
        decision: "always",
      });
    });
  });

  describe("the default", () => {
    it("is `always`, because the boot path only runs on a configured node", () => {
      // Every caller is the restart path of a node whose setup already completed
      // (`setupState === "setup_done"`). On that node, an install with no
      // credentials is orphaned, so ensuring one is the correct default.
      const resolved = resolveAdminBootstrapDecision({});

      expect(resolved.decision).toBe("always");
      expect(resolved.reason).toContain("already-configured");
    });

    it("explains WHY the decision was made, for the boot log", () => {
      // The reason is logged on every boot; an empty or generic string would make
      // "why did this create an admin?" unanswerable from the logs alone.
      for (const decision of [
        resolveAdminBootstrapDecision({ adminBootstrap: "true" }),
        resolveAdminBootstrapDecision({ adminBootstrap: "false" }),
        resolveAdminBootstrapDecision({ nodeEnv: "production", enableSeeding: "true" }),
        resolveAdminBootstrapDecision({}),
      ]) {
        expect(decision.reason.length).toBeGreaterThan(10);
      }
    });
  });
});
