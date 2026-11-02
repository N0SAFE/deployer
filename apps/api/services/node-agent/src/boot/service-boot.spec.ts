import "@orpc/effect/extensions/effect";
import "@deployer/shared/core/orpc/context";

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMeshClient } from "@deployer/mesh-client";
import { MESH_WEBSOCKET_PATH, type nodeAgentContract } from "@deployer/node-agent-contracts";
import { createApiServerApp } from "@deployer/shared/server";

import { peerLink } from "./boot-agent";

import type { INestApplication } from "@nestjs/common";
import type { ContractRouterClient } from "@orpc/contract";

const SECRET = "node-agent-e2e-secret-of-at-least-32-chars";

type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>;

/**
 * The node-agent boots, and says so.
 *
 * It lives beside the unit specs, not in `src/e2e`: the e2e project provisions a Postgres container, and an agent has
 * no database to provision.
 *
 * Booting the real root module is the check that matters: a provider that cannot be resolved fails the whole Nest
 * container before the first request, so a served request proves the dependency graph resolves with the real wiring,
 * with no database and no auth module in it.
 *
 * The mesh procedures have no HTTP surface: they answer on the peer websocket, behind the swarm's credential.
 */
describe("node-agent service boot e2e", () => {
  let app: INestApplication;
  let origin: string;
  let ws: string;

  beforeAll(async () => {
    process.env.NODE_AGENT_SECRET = SECRET;
    process.env.MESH_NODE_ID = "node-e2e";
    process.env.NODE_AGENT_DATA_DIR = mkdtempSync(join(tmpdir(), "node-agent-boot-"));
    const { NodeAgentServiceModule } = await import("@/app.module");
    app = await createApiServerApp(NodeAgentServiceModule);
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
    ws = `${origin.replace(/^http/, "ws")}${MESH_WEBSOCKET_PATH}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves its liveness probe", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
  });

  it("serves no HTTP route for a mesh procedure", async () => {
    const response = await fetch(`${origin}/mesh/roster/token`, { method: "POST" });

    expect(response.status).toBe(404);
  });

  it("refuses a peer without the mesh credential", async () => {
    const link = peerLink(ws);
    try {
      await expect(Effect.runPromise(createMeshClient<NodeAgentClient>(link).directory.snapshot({}))).rejects.toBeDefined();
    } finally {
      await link.closeAll();
    }
  });

  it("serves the snapshot to a peer that holds the credential", async () => {
    const link = peerLink(ws, SECRET);
    try {
      await expect(
        Effect.runPromise(createMeshClient<NodeAgentClient>(link).directory.snapshot({})),
      ).resolves.toEqual({ replicas: [] });
    } finally {
      await link.closeAll();
    }
  });

  it("registers a replica and resolves it for a peer that holds the credential", async () => {
    const link = peerLink(ws, SECRET);
    try {
      const mesh = createMeshClient<NodeAgentClient>(link);
      await Effect.runPromise(
        mesh.directory.register({ service: "runtime", replicaId: "runtime-1", address: "http://runtime-1", keys: ["stream-1"] }),
      );

      await expect(
        Effect.runPromise(mesh.directory.resolve({ service: "runtime", key: "stream-1" })),
      ).resolves.toMatchObject({ reason: "key-holder", replica: { replicaId: "runtime-1", nodeId: "node-e2e" } });
    } finally {
      await link.closeAll();
    }
  });
});
