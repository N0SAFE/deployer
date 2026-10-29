import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { joinServiceMeshOnNode } from "./join-service-mesh-on-node";

describe("joinServiceMeshOnNode", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("runs the service as it always did when the node has no agent, and says so", () => {
    const log = vi.fn();

    const membership = joinServiceMeshOnNode({
      service: "project",
      port: 3103,
      server: createServer(),
      contracts: [],
      env: { MESH_AGENT_SOCKET: "/nowhere/agent.sock" },
      log,
    });

    expect(membership).toBeUndefined();
    expect(log).toHaveBeenCalledWith("[project] No mesh agent at /nowhere/agent.sock: running without the mesh");
  });

  it("joins when there is an agent, advertising the address the deployment gave it", async () => {
    const directory = mkdtempSync(join(tmpdir(), "on-node-"));
    dirs.push(directory);
    const socket = join(directory, "agent.sock");
    writeFileSync(socket, "");
    const log = vi.fn();

    const membership = joinServiceMeshOnNode({
      service: "project",
      port: 3103,
      server: createServer(),
      contracts: [],
      env: { MESH_AGENT_SOCKET: socket, MESH_ADVERTISE_URL: "ws://project-host:3103/mesh/ws" },
      log,
    });

    expect(membership).toBeDefined();
    expect(log).toHaveBeenCalledWith(`[project] Joined the mesh through ${socket}, advertised at ws://project-host:3103/mesh/ws`);
    await membership?.stop();
  });
});
