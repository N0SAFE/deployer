import { beforeAll, describe, expect, it } from "vitest";
import {
  getSharedApiRuntimeContext,
  type SharedApiRuntimeContext,
} from "@/e2e/utils/shared-api-runtime";

describe("Module HTTP guard matrix e2e", () => {
  let context: SharedApiRuntimeContext;

  beforeAll(async () => {
    context = await getSharedApiRuntimeContext();
  });

  it("keeps public health check available", async () => {
    const response = await context.http.get("/health").expect(200);
    const payload = response.body as { status: string; timestamp: string };

    expect(typeof payload.status).toBe("string");
    expect(typeof payload.timestamp).toBe("string");
  });

  it("protects health detailed endpoint", async () => {
    await context.http.get("/health/detailed").expect(401);
  });

  it("protects major module list/query endpoints", async () => {
    await context.http.get("/user").expect(401);
    await context.http.get("/projects").expect(401);
    await context.http.get("/services").expect(401);
    await context.http.get("/deployments").expect(401);
    await context.http.get("/analytics/metrics/deployments").expect(401);
    await context.http.get("/providers").expect(401);
    await context.http.get("/push/subscriptions").expect(401);
    await context.http.get("/core/fleet/servers").expect(401);
  });

  it("reports template list route as not yet mounted", async () => {
    await context.http.get("/templates").expect(404);
  });
});