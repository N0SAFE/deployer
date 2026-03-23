import { beforeAll, describe, expect, it } from "vitest";
import { getSharedApiRuntimeContext } from "@/e2e/utils/shared-api-runtime";

describe("Setup API e2e: configure database", () => {
  let databaseUrl: string;
  let http: Awaited<ReturnType<typeof getSharedApiRuntimeContext>>["http"];

  beforeAll(async () => {
    const context = await getSharedApiRuntimeContext();
    databaseUrl = context.runtime.databaseUrl;
    http = context.http;
  });

  it("POST /setup/configure-database validates a real Postgres URL (testOnly)", async () => {
    const response = await http
      .post("/setup/configure-database")
      .send({
        databaseUrl,
        testOnly: true,
      })
      .expect(200);

    const payload = response.body as {
      connected: boolean;
      isNewDatabase: boolean;
      nodeId: string;
      state: { state: string };
    };

    expect(payload.connected).toBe(true);
    expect(payload.isNewDatabase).toBe(true);
    expect(typeof payload.nodeId).toBe("string");
    expect(payload.nodeId.length).toBeGreaterThan(0);
    expect(typeof payload.state.state).toBe("string");
    expect(payload.state.state.length).toBeGreaterThan(0);
  });

  it("GET /setup/status returns bootstrap state snapshot", async () => {
    const response = await http
      .get("/setup/status")
      .expect(200);

    const payload = response.body as {
      needsSetup: boolean;
      state: string;
      hasUsers: boolean;
      hasOrganizations: boolean;
    };

    expect(payload.needsSetup).toBe(true);
    expect(typeof payload.state).toBe("string");
    expect(payload.hasUsers).toBe(false);
    expect(payload.hasOrganizations).toBe(false);
  });
});
