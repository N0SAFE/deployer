import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getSharedApiRuntimeContext,
  type SharedApiRuntimeContext,
} from "@/e2e/utils/shared-api-runtime";

describe("Module contract surfaces e2e: public + auth boundaries", () => {
  let context: SharedApiRuntimeContext;

  beforeAll(async () => {
    context = await getSharedApiRuntimeContext();
  });

  const expectAnonymousUnauthorized = async (
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

  it("health.check remains publicly accessible", async () => {
    const result = await context.orpc.health.check({});

    expect(typeof result.status).toBe("string");
    expect(typeof result.timestamp).toBe("string");
  });

  it("health.detailed rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.health.detailed({}),
      "/health/detailed",
    );
  });

  it("user.list rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.user.list({ query: {} }),
      "/user",
    );
  });

  it("project.list rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.project.list({ query: {} }),
      "/projects",
    );
  });

  it("service.list rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.service.list({ query: {} }),
      "/services",
    );
  });

  it("deployment.list rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.deployment.list({ query: {} }),
      "/deployments",
    );
  });

  it("template.list currently reports route-not-mounted (404)", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.template.list({ query: {} }),
      "/templates",
      404,
    );
  });

  it("analytics.getDeploymentMetrics rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.analytics.getDeploymentMetrics({}),
      "/analytics/metrics/deployments",
    );
  });

  it("providerSchema.getAllProviders rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.providerSchema.getAllProviders({}),
      "/providers",
    );
  });

  it("domain.listOrganizationDomains rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () =>
        context.orpc.domain.listOrganizationDomains({
          organizationId: randomUUID(),
        }),
      "/domains",
    );
  });

  it("organization.admin.listAll rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.organization.admin.listAll({ query: {} }),
      "/organization/admin",
    );
  });

  it("push.getSubscriptions rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.push.getSubscriptions({}),
      "/push/subscriptions",
    );
  });

  it("core.fleet.listServers rejects anonymous access", async () => {
    await expectAnonymousUnauthorized(
      () => context.orpc.core.fleet.listServers({}),
      "/core/fleet/servers",
    );
  });
});