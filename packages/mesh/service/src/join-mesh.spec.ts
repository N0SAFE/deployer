import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { os } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { openWebSocketConnection, pooledLink } from "@deployer/mesh-client";
import { attachMeshWebSocket } from "@deployer/mesh-server";

import { joinMesh, type MeshMembership } from "./join-mesh";

import type { ClientContext } from "@orpc/client";
import type { AddressInfo } from "node:net";

/** The only party that knows the swarm's credential. A service never sees it. */
const SWARM_SECRET = "the-swarm-secret-only-the-agent-knows";

type Registration = { service: string; replicaId: string; address: string; load: number; keys: string[]; ttlMs: number };

/**
 * A stand-in for the local agent, on a unix socket like the real one: it records registrations, and answers whether a
 * presented credential is the swarm's.
 */
async function fakeAgent(directory: string) {
  const registrations: Registration[] = [];
  const questions: { presented: string; replicaId: string }[] = [];
  const socketPath = join(directory, "agent.sock");
  const server = createServer();
  const gateway = attachMeshWebSocket({
    server,
    path: MESH_WEBSOCKET_PATH,
    router: {
      directory: {
        register: os
          .input(z.object({ service: z.string(), replicaId: z.string(), address: z.string(), load: z.number(), keys: z.array(z.string()), ttlMs: z.number() }))
          .handler(({ input }) => {
            registrations.push(input);
            return input;
          }),
      },
      access: {
        verify: os.input(z.object({ presented: z.string(), replicaId: z.string() })).handler(({ input }) => {
          questions.push(input);
          return { ok: input.presented === SWARM_SECRET };
        }),
      },
    } as never,
    verify: () => true,
    context: () => ({}),
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  return {
    registrations,
    questions,
    socketPath,
    close: async () => {
      await gateway.close();
      await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    },
  };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}`;
}

const eventually = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3_000, interval: 10 });

describe("joinMesh", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) {
      await close();
    }
  });

  async function boot(overrides: { keys?: () => string[] } = {}) {
    const directory = mkdtempSync(join(tmpdir(), "join-mesh-"));
    cleanup.push(() => {
      rmSync(directory, { recursive: true, force: true });
      return Promise.resolve();
    });
    const agent = await fakeAgent(directory);
    cleanup.push(agent.close);

    const server = createServer();
    const address = await listen(server);
    const membership: MeshMembership = joinMesh({
      service: "runtime",
      replicaId: "runtime-1",
      server,
      router: { ping: os.handler(() => ({ pong: true })) } as never,
      context: () => ({}),
      agentSocketPath: agent.socketPath,
      advertiseUrl: address,
      keys: overrides.keys,
      load: () => 0.4,
      heartbeatMs: 20,
    });
    cleanup.push(async () => {
      await membership.stop();
      await new Promise<void>((resolve) => server.close(() => { resolve(); }));
    });
    return { agent, address };
  }

  const clientTo = (address: string, credential: string) =>
    pooledLink<ClientContext>({
      target: address,
      maxConnections: 1,
      multiplex: 4,
      idleMs: 1_000,
      open: () => Promise.resolve(openWebSocketConnection({ url: `${address}?credential=${credential}`, reconnectDelayMs: 10 })),
    });

  it("registers with the local agent through its socket, with its address, load and the keys it holds now", async () => {
    let keys = ["container-1"];
    const { agent, address } = await boot({ keys: () => keys });

    await eventually(() => { expect(agent.registrations.length).toBeGreaterThan(0); });
    keys = ["container-1", "container-2"];
    await eventually(() => { expect(agent.registrations[agent.registrations.length - 1]?.keys).toEqual(["container-1", "container-2"]); });

    expect(agent.registrations[0]).toEqual({ service: "runtime", replicaId: "runtime-1", address, load: 0.4, keys: ["container-1"], ttlMs: 80 });
  });

  it("answers a peer the agent vouches for, without ever holding the credential itself", async () => {
    const { agent, address } = await boot();
    const link = clientTo(address, SWARM_SECRET);

    await expect(link.call(["ping"], undefined, { context: {} })).resolves.toEqual({ pong: true });

    expect(agent.questions).toEqual([{ presented: SWARM_SECRET, replicaId: "runtime-1" }]);
    await link.closeAll();
  });

  it("refuses a peer the agent does not vouch for", async () => {
    const { address } = await boot();
    const link = clientTo(address, "guess");

    await expect(link.call(["ping"], undefined, { context: {} })).rejects.toBeDefined();
    await link.closeAll();
  });

  it("asks the agent once for a peer it already vouched for, however many connections it opens", async () => {
    const { agent, address } = await boot();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const link = clientTo(address, SWARM_SECRET);
      await link.call(["ping"], undefined, { context: {} });
      await link.closeAll();
    }

    expect(agent.questions).toHaveLength(1);
  });

  it("refuses everyone when it cannot reach its agent: unknown is not trusted", async () => {
    const { agent, address } = await boot();
    await agent.close();
    cleanup.splice(cleanup.indexOf(agent.close), 1);
    const link = clientTo(address, SWARM_SECRET);

    await expect(link.call(["ping"], undefined, { context: {} })).rejects.toBeDefined();
    await link.closeAll();
  });

  it("stops beating when it stops", async () => {
    const directory = mkdtempSync(join(tmpdir(), "join-mesh-"));
    cleanup.push(() => {
      rmSync(directory, { recursive: true, force: true });
      return Promise.resolve();
    });
    const agent = await fakeAgent(directory);
    cleanup.push(agent.close);
    const server = createServer();
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => { resolve(); })));
    const membership = joinMesh({ service: "runtime", replicaId: "runtime-1", server, router: {} as never, context: () => ({}), agentSocketPath: agent.socketPath, advertiseUrl: "ws://x", heartbeatMs: 20 });

    await eventually(() => { expect(agent.registrations.length).toBeGreaterThan(0); });
    await membership.stop();
    const after = agent.registrations.length;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(agent.registrations.length).toBe(after);
  });
});
