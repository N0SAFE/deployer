import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getSharedApiRuntimeContext, stopSharedApiRuntime, type SharedApiRuntimeContext } from "@/e2e/runtime";

import type { AddressInfo } from "node:net";

/** Every service the BFF delegates to (`modules/delegation/generated`). */
const SERVICES = ["fleet", "health", "identity", "project", "runtime"] as const;
const INSTANCE = "contract-surfaces";

/**
 * The public / authenticated boundary of the API surface, as the BFF serves it.
 *
 * The BFF is the one entry point, so this is where "who may call what" is pinned: one public probe, and one anonymous
 * call per namespace that must be refused. Each case checks BOTH that the call is rejected AND that the rejection is the
 * auth one (`401`) on the route the contract declares, so a missing route (404), a dependency failure (424) or a crash
 * (500) cannot pass as "protected".
 *
 * ── WHO REFUSES ─────────────────────────────────────────────────────────────
 * Not the BFF. A delegated procedure carries no `requireAuth()` (see the generated controllers): authorization is a
 * property of the PROCEDURE, and the SERVICE enforces it on the leg it receives, with the caller's credentials in hand —
 * re-applying a blanket session requirement at the BFF would break the procedures that are legitimately public. So an
 * anonymous call is refused by the service and the BFF must carry that refusal to the caller as a `401`.
 *
 * The upstream below stands in for those services: it answers what a real one answers an anonymous caller, a plain-text
 * `401`. Without it the fan-out reaches no service at all and fails as a dependency error, which says nothing about
 * auth. What is pinned is the BFF's side of the contract: the route exists, the call is delegated with the caller's
 * (absent) credentials, and the service's refusal comes back as a 401 rather than a 5xx.
 */
describe("Module contract surfaces e2e: public + auth boundaries", () => {
  let context: SharedApiRuntimeContext;
  let upstream: Server;
  let previousUrls: string | undefined;

  beforeAll(async () => {
    // Refuses everything, as a service does an anonymous caller.
    upstream = createServer((_request, response) => {
      response.writeHead(401, { "content-type": "text/plain" }).end("Unauthorized");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${String((upstream.address() as AddressInfo).port)}`;

    // Set BEFORE the BFF boots: the registry resolves and caches a service's origin on first use.
    previousUrls = process.env.API_SERVICE_URLS;
    process.env.API_SERVICE_URLS = JSON.stringify(Object.fromEntries(SERVICES.map((service) => [service, origin])));
    context = await getSharedApiRuntimeContext({ instanceKey: INSTANCE });
  }, 180_000);

  afterAll(async () => {
    await stopSharedApiRuntime({ instanceKey: INSTANCE });
    if (previousUrls === undefined) delete process.env.API_SERVICE_URLS;
    else process.env.API_SERVICE_URLS = previousUrls;
    await new Promise<void>((resolve) => upstream.close(() => { resolve(); }));
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
    // only thing keeping the public off it is the system-actor claim the runtime SERVICE demands
    // (the upstream stub answers 401 as that service would).
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
