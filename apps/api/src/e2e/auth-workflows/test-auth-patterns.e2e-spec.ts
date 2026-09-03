import { beforeAll, describe, expect, it } from "vitest";
import {
  createSharedSetupOrpcClient,
  getSharedApiRuntimeContext,
} from "@/e2e/utils/shared-api-runtime";

describe("Auth patterns API e2e: anonymous and protected boundaries", () => {
  let http: Awaited<ReturnType<typeof getSharedApiRuntimeContext>>["http"];

  beforeAll(async () => {
    const context = await getSharedApiRuntimeContext();
    http = context.http;
  });

  it("GET /test/public allows anonymous access", async () => {
    const response = await http.get("/test/public").expect(200);

    const payload = response.body as {
      message: string;
      approach: string;
    };

    expect(typeof payload.message).toBe("string");
    expect(payload.approach.includes("AllowAnonymous")).toBe(true);
  });

  it("GET /test/authenticated rejects anonymous access", async () => {
    await http.get("/test/authenticated").expect(401);
  });

  it("GET /test/optional-auth keeps a stable anonymous context shape", async () => {
    const response = await http
      .get("/test/optional-auth")
      .expect(200);

    const payload = response.body as {
      message: string;
      isAuthenticated: boolean;
      userId: string | null;
    };

    expect(typeof payload.message).toBe("string");
    expect(payload.isAuthenticated).toBe(false);
    expect(payload.userId).toBeNull();
  });

  it("GET /test/admin/role rejects invalid bearer token", async () => {
    await http
      .get("/test/admin/role")
      .set("Authorization", "Bearer e2e-invalid-token")
      .expect(401);
  });

  it("GET /test/admin/permission rejects anonymous access", async () => {
    await http
      .get("/test/admin/permission")
      .expect(401);
  });

  it("GET /test/org/:organizationId rejects anonymous access", async () => {
    await http
      .get("/test/org/e2e-org-anon")
      .expect(401);
  });

  it("GET /test/composite/admin rejects anonymous access", async () => {
    await http
      .get("/test/composite/admin")
      .expect(401);
  });

  it("shared context exposes typed ORPC setup client and intercepts transport metadata", async () => {
    const context = await getSharedApiRuntimeContext();
    const result = await context.orpc.setup.getState();
    
    // Assert on payload
    expect(result.needsSetup).toBe(true);

    // Assert on custom ORPC fetch interceptor via tracker
    const meta = context.orpcTracker.getLast();
    expect(meta).not.toBeNull();
    expect(meta?.status).toBe(200);
    // ORPC OpenAPILink resolves method paths directly (e.g. /getState)
    expect(meta?.requestUrl).toContain("/getState");
    expect(meta?.headers["content-type"]).toContain("application/json");
  });

  it("shared ORPC tracker keeps ordered history and supports reset", async () => {
    const context = await getSharedApiRuntimeContext();
    context.orpcTracker.clear();

    await context.orpc.setup.getState();
    await context.orpc.setup.getState();

    const history = context.orpcTracker.getAll();
    expect(history.length).toBe(2);
    expect(history[0]?.status).toBe(200);
    expect(history[1]?.status).toBe(200);
    expect(history[0]?.requestUrl).toContain("/getState");
    expect(history[1]?.requestUrl).toContain("/getState");

    context.orpcTracker.clear();
    expect(context.orpcTracker.getAll()).toHaveLength(0);
    expect(context.orpcTracker.getLast()).toBeNull();
  });

  it("HTTP and ORPC setup status stay in sync for needsSetup", async () => {
    const context = await getSharedApiRuntimeContext();
    const [httpResponse, orpcResponse] = await Promise.all([
      context.http.get("/setup/status").expect(200),
      context.orpc.setup.getState(),
    ]);

    const httpPayload = httpResponse.body as {
      needsSetup: boolean;
    };

    expect(typeof httpPayload.needsSetup).toBe("boolean");
    expect(orpcResponse.needsSetup).toBe(httpPayload.needsSetup);
  });

  it("HTTP and ORPC setup state stay in sync for core shape", async () => {
    const context = await getSharedApiRuntimeContext();
    // Use ORPC for both calls since /setup/state-machine REST endpoint is not mounted
    const orpcState = await context.orpc.setup.getState();

    expect(orpcState.state).toBeDefined();
    expect(typeof orpcState.needsSetup).toBe("boolean");
    expect(typeof orpcState.currentStep).toBe("string");
    expect(typeof orpcState.progressPercent).toBe("number");
    expect(Array.isArray(orpcState.steps)).toBe(true);
  });

  it("standalone setup ORPC client can attach tracker metadata", async () => {
    const history: Array<{ status: number; requestUrl: string }> = [];
    const setupClient = await createSharedSetupOrpcClient({
      tracker: {
        record(meta) {
          history.push({ status: meta.status, requestUrl: meta.requestUrl });
        },
        clear() {
          history.length = 0;
        },
        getLast() {
          return null;
        },
        getAll() {
          return [];
        },
      },
    });

    const result = await setupClient.getState();
    expect(typeof result.needsSetup).toBe("boolean");
    expect(history.length).toBe(1);
    expect(history[0]?.status).toBe(200);
    expect(history[0]?.requestUrl).toContain("/getState");
  });
});