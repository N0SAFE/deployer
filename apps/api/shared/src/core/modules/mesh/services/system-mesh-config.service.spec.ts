import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SystemMeshConfigService } from "./system-mesh-config.service";

import type { NodeRecord } from "./node-record.client";
import type { NodeMeshConfigRow } from "../repositories/node-mesh-config.repository";

const ROW_NODE_ID = "11111111-1111-4111-8111-111111111111";
const AGENT_NODE_ID = "22222222-2222-4222-8222-222222222222";

function serviceWith(
  row: { nodeId: string } | null,
  mesh: { find?: () => unknown; upsert?: (data: unknown) => unknown } = {},
) {
  const nodeConfigRepo = {
    find: () => Effect.succeed(row),
    upsert: () => Effect.succeed(row),
  } as never;
  const nodeMeshConfigRepo = {
    find: mesh.find ?? (() => ({ syncIntervalMs: 10_000 })),
    upsert: mesh.upsert ?? (() => null),
  } as never;
  const env = { get: () => undefined } as never;
  return new SystemMeshConfigService(env, nodeConfigRepo, nodeMeshConfigRepo);
}

/** The row the local table holds: deliberately different from the mesh section the agent serves. */
const LOCAL_ROW: NodeMeshConfigRow = {
  id: 1,
  nodeServerUrl: "https://local.example.com",
  bootstrapPeersEncrypted: "wss://local-peer",
  syncIntervalMs: 10_000,
  trustStrictMinAckRatio: "1",
  trustStrictMaxAckAgeSeconds: 300,
  trustStrictRolloutWaveSize: 3,
  trustStrictAutoRollback: false,
  controlEnvelopeTrustRequired: false,
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:00:00.000Z",
};

const AGENT_RECORD: NodeRecord = {
  agentId: "agent-a",
  configured: true,
  config: {
    nodeId: AGENT_NODE_ID,
    strategy: "remote",
    setupState: "setup_done",
    deployerVersion: "2.0.0",
    upgradedAtVersion: null,
    databaseUrl: null,
    databaseProvisioning: null,
    meshUrlsSnapshot: [],
    swarmConfig: null,
    peerServiceToken: null,
    peerServiceTokenExpiresAt: null,
    meshSharedSecret: null,
    meshSharedSecretUpdatedAt: null,
    scanConfig: null,
    mesh: {
      nodeServerUrl: "https://agent.example.com",
      bootstrapPeers: "wss://agent-peer",
      syncIntervalMs: 5_000,
      trustStrictMinAckRatio: "0.75",
      trustStrictMaxAckAgeSeconds: 120,
      trustStrictRolloutWaveSize: 2,
      trustStrictAutoRollback: true,
      controlEnvelopeTrustRequired: true,
    },
    postSetupFlags: null,
    configuredAt: "2026-10-30T09:00:00.000Z",
    updatedAt: "2026-10-30T09:30:00.000Z",
  },
};

afterEach(() => {
  Reflect.deleteProperty(process.env, "MESH_NODE_ID");
});

describe("SystemMeshConfigService.getNodeId", () => {
  it("takes the platform node id from the node config the repository resolves (agent first, file second)", async () => {
    const service = serviceWith({ nodeId: ROW_NODE_ID });

    await service.onModuleInit();

    expect(service.getNodeId()).toBe(ROW_NODE_ID);
  });

  it("never creates a node id from the environment: an unconfigured node has none", async () => {
    process.env.MESH_NODE_ID = "node-from-env";
    const service = serviceWith(null);

    await service.onModuleInit();

    expect(service.getNodeId()).toBe("");
  });
});

describe("SystemMeshConfigService mesh config source", () => {
  it("takes the mesh section of the node agent's record over the local row, and writes nothing locally", async () => {
    const upsert = vi.fn(() => LOCAL_ROW);
    const service = serviceWith({ nodeId: ROW_NODE_ID }, { find: () => LOCAL_ROW, upsert });

    await service.applyAgentRecord(AGENT_RECORD);

    expect(service.getNodeId()).toBe(AGENT_NODE_ID);
    expect(service.getNodeServerUrl()).toBe("https://agent.example.com");
    expect(service.getBootstrapPeers()).toBe("wss://agent-peer");
    expect(service.getSyncIntervalMs()).toBe(5_000);
    expect(service.getTrustStrictMinAckRatio()).toBe(0.75);
    expect(service.getTrustStrictMaxAckAgeSeconds()).toBe(120);
    expect(service.getTrustStrictRolloutWaveSize()).toBe(2);
    expect(service.getTrustStrictAutoRollback()).toBe(true);
    expect(service.getControlEnvelopeTrustRequired()).toBe(true);
    // The agent owns the record: the local row is neither read over it nor rewritten behind its back.
    expect(upsert).not.toHaveBeenCalled();
  });
});
