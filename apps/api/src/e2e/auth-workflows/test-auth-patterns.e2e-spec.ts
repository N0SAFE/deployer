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
    const result = await context.orpc.setup.getStatus();
    
    // Assert on payload
    expect(result.needsSetup).toBe(true);

    // Assert on custom ORPC fetch interceptor via tracker
    const meta = context.orpcTracker.getLast();
    expect(meta).not.toBeNull();
    expect(meta?.status).toBe(200);
    expect(meta?.requestUrl).toContain("/setup/status");
    expect(meta?.headers["content-type"]).toContain("application/json");
  });

  it("shared ORPC tracker keeps ordered history and supports reset", async () => {
    const context = await getSharedApiRuntimeContext();
    context.orpcTracker.clear();

    await context.orpc.setup.getStatus();
    await context.orpc.setup.getStatus();

    const history = context.orpcTracker.getAll();
    expect(history.length).toBe(2);
    expect(history[0]?.status).toBe(200);
    expect(history[1]?.status).toBe(200);
    expect(history[0]?.requestUrl).toContain("/setup/status");
    expect(history[1]?.requestUrl).toContain("/setup/status");

    context.orpcTracker.clear();
    expect(context.orpcTracker.getAll()).toHaveLength(0);
    expect(context.orpcTracker.getLast()).toBeNull();
  });

  it("HTTP and ORPC setup status stay in sync for needsSetup", async () => {
    const context = await getSharedApiRuntimeContext();
    const [httpResponse, orpcResponse] = await Promise.all([
      context.http.get("/setup/status").expect(200),
      context.orpc.setup.getStatus(),
    ]);

    const httpPayload = httpResponse.body as {
      needsSetup: boolean;
    };

    expect(typeof httpPayload.needsSetup).toBe("boolean");
    expect(orpcResponse.needsSetup).toBe(httpPayload.needsSetup);
  });

  it("HTTP and ORPC setup state machine stay in sync for core shape", async () => {
    const context = await getSharedApiRuntimeContext();
    const [httpResponse, orpcResponse] = await Promise.all([
      context.http.get("/setup/state-machine").expect(200),
      context.orpc.setup.getStateMachine(),
    ]);

    const httpPayload = httpResponse.body as {
      initialState: string;
      states: string[];
      terminalStates: string[];
      transitions: Array<{ event: string }>;
    };

    expect(httpPayload.initialState).toBe(orpcResponse.initialState);
    expect(httpPayload.states).toEqual(orpcResponse.states);
    expect(httpPayload.terminalStates).toEqual(orpcResponse.terminalStates);
    expect(httpPayload.transitions.length).toBe(orpcResponse.transitions.length);
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

    const result = await setupClient.getStatus();
    expect(typeof result.needsSetup).toBe("boolean");
    expect(history.length).toBe(1);
    expect(history[0]?.status).toBe(200);
    expect(history[0]?.requestUrl).toContain("/setup/status");
  });
});