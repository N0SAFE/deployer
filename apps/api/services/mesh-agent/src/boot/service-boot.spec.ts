import "@orpc/effect/extensions/effect";
import "@deployer/shared/core/orpc/context";



import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MESH_CREDENTIAL_HEADER, createApiServerApp } from "@deployer/shared/server";

import type { INestApplication } from "@nestjs/common";

const SECRET = "mesh-agent-e2e-secret-of-at-least-32-chars";

/**
 * The mesh-agent boots, and says so.
 *
 * It lives beside the unit specs, not in `src/e2e`: the e2e project provisions a Postgres container, and an agent has
 * no database to provision.
 *
 * Booting the real root module is the check that matters: a provider that cannot be resolved fails the whole Nest
 * container before the first request, so a served request proves the dependency graph resolves with the real wiring,
 * with no database and no auth module in it.
 */
describe("mesh-agent service boot e2e", () => {
  let app: INestApplication;
  let origin: string;

  beforeAll(async () => {
    process.env.MESH_AGENT_SECRET = SECRET;
    process.env.MESH_NODE_ID = "node-e2e";
    process.env.MESH_DATA_DIR = mkdtempSync(join(tmpdir(), "mesh-agent-boot-"));
    const { MeshAgentServiceModule } = await import("@/app.module");
    app = await createApiServerApp(MeshAgentServiceModule);
    await app.listen(0, "127.0.0.1");
    origin = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  const headers = (credential?: string) => ({
    "content-type": "application/json",
    ...(credential ? { [MESH_CREDENTIAL_HEADER]: credential } : {}),
  });
  const post = (path: string, body: unknown, credential?: string) =>
    fetch(`${origin}${path}`, { method: "POST", headers: headers(credential), body: JSON.stringify(body) });
  const get = (path: string, credential?: string) => fetch(`${origin}${path}`, { headers: headers(credential) });

  it("serves its liveness probe", async () => {
    const response = await fetch(`${origin}/health`);

    expect(response.status).toBe(200);
  });

  it("refuses a request without the mesh credential", async () => {
    const response = await get("/mesh/directory/snapshot");

    expect(response.status).toBe(401);
  });

  it("refuses a request with the wrong credential", async () => {
    const response = await post("/mesh/directory/register", { service: "x", replicaId: "x-1", address: "http://x" }, "wrong");

    expect(response.status).toBe(401);
  });

  it("serves the snapshot to a peer that holds the credential", async () => {
    const response = await get("/mesh/directory/snapshot", SECRET);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ replicas: [] });
  });

  it("registers a replica and resolves it for a peer that holds the credential", async () => {
    const registered = await post(
      "/mesh/directory/register",
      { service: "runtime", replicaId: "runtime-1", address: "http://runtime-1", keys: ["stream-1"] },
      SECRET,
    );
    expect(registered.status).toBe(200);

    const resolved = await post("/mesh/directory/resolve", { service: "runtime", key: "stream-1" }, SECRET);
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({ reason: "key-holder", replica: { replicaId: "runtime-1", nodeId: "node-e2e" } });
  });
});
