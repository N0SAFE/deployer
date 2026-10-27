import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { getSharedApiRuntimeContext, type SharedApiRuntimeContext } from "@/e2e/runtime";

/**
 * The public / authenticated boundary of the API surface, as the BFF serves it.
 *
 * The BFF is the one entry point, so this is where "who may call what" is pinned: one
 * public probe, and one anonymous call per namespace that must be refused. Each case checks
 * BOTH that the call is rejected AND that the rejection is the auth one (`401`) on the route
 * the contract declares, so a missing route (404) or a crash (500) cannot pass as "protected".
 */
describe("Module contract surfaces e2e: public + auth boundaries", () => {
  let context: SharedApiRuntimeContext;

  beforeAll(async () => {
    context = await getSharedApiRuntimeContext();
  });

  const expectAnonymousRejected = async (
    operation: () => Promise<unknown>,
    expectedPathFragment: string,
    expectedStatus = 401,
  ) => {
    context.orpcTracker.clear();

    await expect(operation()).rejects.toBeDefined();

    const meta = context.orpcTracker.getLast();
    expect(meta).not.toBeNull();
    expect(meta?.status).toBe(expectedStatus);
    expect(meta?.requestUrl).toContain(expectedPathFragment);
  };

  it("health.check stays publicly accessible", async () => {
    const result = await context.orpc.health.check({});

    expect(typeof result.status).toBe("string");
    // Not asserted: `timestamp`. The contract declares it required (`z.date()`), but the service
    // answers `{ status, uptime }` and oRPC does not validate outputs, so the mismatch is
    // invisible until a client reads the field. Tracked in the audit, not pinned here.
    expect(typeof (result as { uptime?: unknown }).uptime).toBe("number");
  });

  it("health.detailed rejects anonymous access", async () => {
    await expectAnonymousRejected(() => context.orpc.health.detailed({}), "/health/detailed");
  });

  it("user.list rejects anonymous access", async () => {
    await expectAnonymousRejected(() => context.orpc.user.list({ query: { limit: 20, offset: 0 } }), "/user");
  });

  it("project.list rejects anonymous access", async () => {
    await expectAnonymousRejected(
      () => context.orpc.project.list({ query: { limit: 20, offset: 0 } }),
      "/projects",
    );
  });

  it("service.crud.list rejects anonymous access", async () => {
    await expectAnonymousRejected(
      () => context.orpc.service.crud.list({ query: { limit: 20, offset: 0 } }),
      "/services",
    );
  });

  it("deployment.list rejects anonymous access", async () => {
    await expectAnonymousRejected(
      () => context.orpc.deployment.list({ query: { limit: 20, offset: 0 } }),
      "/deployments",
    );
  });

  it("analytics.getDeploymentMetrics rejects anonymous access", async () => {
    await expectAnonymousRejected(
      () => context.orpc.analytics.getDeploymentMetrics({}),
      "/analytics/metrics/deployments",
    );
  });

  it("providerSchema.getAllProviders rejects anonymous access", async () => {
    await expectAnonymousRejected(() => context.orpc.providerSchema.getAllProviders({}), "/providers");
  });

  it("domain.listProjectDomains rejects anonymous access", async () => {
    await expectAnonymousRejected(
      () => context.orpc.domain.listProjectDomains({ params: { projectId: randomUUID() } }),
      "/domains/",
    );
  });

  it("push.getSubscriptions rejects anonymous access", async () => {
    await expectAnonymousRejected(() => context.orpc.push.getSubscriptions({}), "/push/subscriptions");
  });

  it("nodes.listServers rejects anonymous access", async () => {
    await expectAnonymousRejected(() => context.orpc.nodes.listServers({}), "/nodes/servers");
  });

  it("deployment.triggerFromEvent, a peer-only procedure on the composed surface, rejects an anonymous caller", async () => {
    // It is reachable through the BFF because the BFF composes every service contract, so the
    // only thing keeping the public off it is the system-actor claim runtime demands.
    await expectAnonymousRejected(
      () =>
        context.orpc.deployment.triggerFromEvent({
          provider: "github",
          eventName: "push",
          payload: {},
        }),
      "/trigger-event",
    );
  });
});
