import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";

import { type ClientContext } from "@orpc/client";
import { os } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { MESH_WEBSOCKET_PATH } from "@deployer/node-agent-contracts";
import { openWebSocketConnection, pooledLink } from "@deployer/mesh-client";
import { attachMeshWebSocket } from "@deployer/mesh-server";

import { joinServiceMeshOnNode, type JoinOnNodeOptions } from "./join-service-mesh-on-node";

import type { AddressInfo } from "node:net";

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
      env: { NODE_AGENT_SOCKET: "/nowhere/agent.sock" },
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
      env: { NODE_AGENT_SOCKET: socket, MESH_ADVERTISE_URL: "ws://project-host:3103/mesh/ws" },
      log,
    });

    expect(membership).toBeDefined();
    expect(log).toHaveBeenCalledWith(`[project] Joined the mesh through ${socket}, advertised at ws://project-host:3103/mesh/ws`);
    await membership?.stop();
  });

  it("names the socket and the errno when it exists but the first registration fails, and still returns the membership", async () => {
    const directory = mkdtempSync(join(tmpdir(), "on-node-"));
    dirs.push(directory);
    // The socket file exists, but nothing listens on it: exactly the state of an agent that died under its services.
    const socket = join(directory, "agent.sock");
    writeFileSync(socket, "");
    const log = vi.fn();

    const membership = joinServiceMeshOnNode({
      service: "project",
      port: 3103,
      server: createServer(),
      contracts: [],
      env: { NODE_AGENT_SOCKET: socket, MESH_ADVERTISE_URL: "ws://project-host:3103/mesh/ws" },
      log,
    });

    expect(membership).toBeDefined();
    await vi.waitFor(
      () => {
        expect(log).toHaveBeenCalledWith(expect.stringContaining(`agent socket ${socket} exists but the first registration failed`));
      },
      { timeout: 5_000 },
    );
    const failure = (log.mock.calls as [string][]).map(([message]) => message).find((message) => message.includes("first registration failed"));
    // The socket, and why: the errno when the transport keeps it, its own message when it wraps it away.
    expect(failure).toContain(socket);
    expect(failure).toMatch(/\((?:[A-Z][A-Z0-9_]+|.+)\)/);
    await membership?.stop();
  });

  describe("the peer class", () => {
    /** An agent that answers over its socket: it takes beats, vouches for peers, and knows its own node id. */
    async function fakeAgent(nodeId: string) {
      const directory = mkdtempSync(join(tmpdir(), "on-node-"));
      dirs.push(directory);
      const socket = join(directory, "agent.sock");
      const server = createServer();
      const gateway = attachMeshWebSocket({
        server,
        path: MESH_WEBSOCKET_PATH,
        router: {
          directory: { register: os.input(z.any()).handler(({ input }) => input) },
          access: { verify: os.input(z.any()).handler(() => ({ ok: true })) },
          roster: {
            view: os
              .input(z.any())
              .handler(() => ({ self: { nodeId, address: "ws://agent", overlay: null, labels: {} }, agents: [] })),
          },
          node: {
            status: os.input(z.any()).handler(() => ({
              agentId: nodeId,
              swarmId: "swarm-1",
              load: { eventLoopLagMs: 2, bytesPerSecond: 10, openStreams: 1 },
              interfaceUp: true,
              meshAddress: null,
              listenPort: 51_820,
              peers: [],
            })),
          },
        } as never,
        verify: () => true,
        context: () => ({}),
      });
      await new Promise<void>((resolve) => server.listen(socket, resolve));
      return async () => {
        await gateway.close();
        await new Promise<void>((resolve) => server.close(() => { resolve(); }));
      };
    }

    /** A caller the agent vouches for, reaching the service's own mesh websocket. */
    function callerTo(http: Server) {
      const address = `ws://127.0.0.1:${String((http.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}`;
      return pooledLink<ClientContext>({
        target: address,
        maxConnections: 1,
        multiplex: 8,
        idleMs: 1_000,
        open: () => Promise.resolve(openWebSocketConnection({ url: `${address}?credential=swarm`, reconnectDelayMs: 10 })),
      });
    }

    async function service(options: { readonly routers?: JoinOnNodeOptions["routers"] } = {}) {
      const stopAgent = await fakeAgent("node-a");
      const http = createServer();
      await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
      const socket = join(dirs[dirs.length - 1] as string, "agent.sock");

      const membership = joinServiceMeshOnNode({
        service: "project",
        port: (http.address() as AddressInfo).port,
        server: http,
        contracts: [],
        keys: () => ["project:p-1"],
        env: { NODE_AGENT_SOCKET: socket },
        log: () => undefined,
        ...options,
      });

      return {
        http,
        membership,
        stop: async () => {
          await membership?.stop();
          await new Promise<void>((resolve) => http.close(() => { resolve(); }));
          await stopAgent();
        },
      };
    }

    it("serves peers.info over the mesh, from the replica id it registered and the keys it beats with", async () => {
      const project = await service();
      const link = callerTo(project.http);

      const info = await link.call(["peers", "info"], {}, { context: {} });

      expect(info).toEqual({
        service: "project",
        replicaId: `project-${hostname()}`,
        nodeId: "node-a",
        load: { eventLoopLagMs: 2, bytesPerSecond: 10, openStreams: 1 },
        keys: ["project:p-1"],
      });
      await link.closeAll();
      await project.stop();
    });

    it("mounts the service's own peer procedures beside info, and never over it", async () => {
      const project = await service({
        routers: { peer: { peers: { ask: os.handler(() => ({ asked: true })) } } as never },
      });
      const link = callerTo(project.http);

      await expect(link.call(["peers", "ask"], {}, { context: {} })).resolves.toEqual({ asked: true });
      await expect(link.call(["peers", "info"], {}, { context: {} })).resolves.toMatchObject({ replicaId: `project-${hostname()}` });

      await link.closeAll();
      await project.stop();
    });
  });
});
