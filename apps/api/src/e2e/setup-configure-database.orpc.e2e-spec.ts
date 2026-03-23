import {
} from "@repo/api-contracts";
import { beforeAll, describe, expect, it } from "vitest";
import { getSharedApiRuntimeContext } from "@/e2e/utils/shared-api-runtime";

describe("Setup API e2e (oRPC client): configure database", () => {
  let databaseUrl: string;

  beforeAll(async () => {
    const context = await getSharedApiRuntimeContext();
    databaseUrl = context.runtime.databaseUrl;
  });

  it("calls setup endpoints through a typed oRPC OpenAPI link", async () => {
    const context = await getSharedApiRuntimeContext();
    const client = context.orpc.setup;

    const statusBefore = await client.getStatus();
    expect(statusBefore.needsSetup).toBe(true);

    const configureResult = await client.configureDatabase({
      databaseUrl,
      testOnly: true,
    });

    expect(configureResult.connected).toBe(true);
    expect(configureResult.nodeId).toBeTypeOf("string");
    expect(configureResult.state).toBeDefined();

    const nodeStatus = await client.getNodeStatus();
    expect(nodeStatus).toHaveProperty("isConfigured");
    expect(typeof nodeStatus.isConfigured).toBe("boolean");
    expect(nodeStatus).toHaveProperty("configuredAt");
    expect(nodeStatus.configuredAt === null || typeof nodeStatus.configuredAt === "string").toBe(true);

    if (nodeStatus.nodeId !== null) {
      expect(nodeStatus.nodeId).toBeTypeOf("string");
    }
  });
});
