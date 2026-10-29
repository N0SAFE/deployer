import { createServer, type Server } from "node:http";


import { os } from "@orpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as z from "zod";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { openWebSocketConnection, pooledLink } from "@deployer/mesh-client";
import { attachMeshWebSocket, credentialVerifier } from "@deployer/mesh-server";

import { joinMesh, type MeshMembership } from "./join-mesh";

import type { ClientContext } from "@orpc/client";
import type { AddressInfo } from "node:net";

const SECRET = "mesh-service-spec-secret";

type Registration = { service: string; replicaId: string; address: string; load: number; keys: string[]; ttlMs: number };

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}${MESH_WEBSOCKET_PATH}`;
}

/** A stand-in for the local agent: it only records what registers with it. */
async function fakeAgent() {
  const registrations: Registration[] = [];
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
    } as never,
    verify: credentialVerifier(SECRET),
    context: () => ({}),
  });
  return { registrations, url: await listen(server), close: async () => { await gateway.close(); await new Promise<void>((resolve) => server.close(() => { resolve(); })); } };
}

const eventually = (assertion: () => void) => vi.waitFor(assertion, { timeout: 3_000, interval: 10 });

describe("joinMesh", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const close of cleanup.splice(0).reverse()) {
      await close();
    }
  });

  async function boot(overrides: { keys?: () => string[]; secret?: string } = {}) {
    const agent = await fakeAgent();
    cleanup.push(agent.close);

    const server = createServer();
    const address = await listen(server);
    const membership: MeshMembership = joinMesh({
      service: "runtime",
      replicaId: "runtime-1",
      server,
      router: { ping: os.handler(() => ({ pong: true })) } as never,
      context: () => ({}),
      secret: overrides.secret ?? SECRET,
      agentUrl: agent.url,
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

  const clientTo = (address: string, credential = SECRET) =>
    pooledLink<ClientContext>({
      target: address,
      maxConnections: 1,
      multiplex: 4,
      idleMs: 1_000,
      open: () => Promise.resolve(openWebSocketConnection({ url: `${address}?credential=${credential}`, reconnectDelayMs: 10 })),
    });

  it("registers with the local agent with its address, load and the keys it holds now", async () => {
    let keys = ["container-1"];
    const { agent, address } = await boot({ keys: () => keys });

    await eventually(() => { expect(agent.registrations.length).toBeGreaterThan(0); });
    keys = ["container-1", "container-2"];
    await eventually(() => { expect(agent.registrations[agent.registrations.length - 1]?.keys).toEqual(["container-1", "container-2"]); });

    expect(agent.registrations[0]).toEqual({ service: "runtime", replicaId: "runtime-1", address, load: 0.4, keys: ["container-1"], ttlMs: 80 });
  });

  it("answers its mesh router over the websocket to a peer holding the credential", async () => {
    const { address } = await boot();
    const link = clientTo(address);

    await expect(link.call(["ping"], undefined, { context: {} })).resolves.toEqual({ pong: true });
    await link.closeAll();
  });

  it("refuses a peer without the credential", async () => {
    const { address } = await boot();
    const link = clientTo(address, "wrong");

    await expect(link.call(["ping"], undefined, { context: {} })).rejects.toBeDefined();
    await link.closeAll();
  });

  it("stops beating when it stops", async () => {
    const agent = await fakeAgent();
    cleanup.push(agent.close);
    const server = createServer();
    cleanup.push(() => new Promise<void>((resolve) => server.close(() => { resolve(); })));
    const membership = joinMesh({ service: "runtime", replicaId: "runtime-1", server, router: {} as never, context: () => ({}), secret: SECRET, agentUrl: agent.url, advertiseUrl: "ws://x", heartbeatMs: 20 });

    await eventually(() => { expect(agent.registrations.length).toBeGreaterThan(0); });
    await membership.stop();
    const after = agent.registrations.length;
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(agent.registrations.length).toBe(after);
  });
});
