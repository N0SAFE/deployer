import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { os, type RouterClient } from "@orpc/server";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as z from "zod";

import { createMeshClient, openWebSocketConnection, pooledLink } from "@deployer/mesh-client";

import { type MeshWebSocket, attachMeshWebSocket } from "./mesh-websocket";

import type { ClientContext } from "@orpc/client";
import type { AddressInfo } from "node:net";

const SECRET = "mesh-server-spec-secret";

async function* count(to: number): AsyncGenerator<number> {
  for (let n = 1; n <= to; n += 1) {
    await Promise.resolve();
    yield n;
  }
}

const router = {
  echo: os.input(z.object({ text: z.string() })).handler(({ input }) => ({ text: input.text })),
  count: os.input(z.object({ to: z.number() })).handler(({ input }) => count(input.to)),
};

describe("attachMeshWebSocket", () => {
  let server: Server;
  let gateway: MeshWebSocket;
  let origin: string;

  beforeEach(async () => {
    server = createServer((_request, response) => response.writeHead(404).end());
    gateway = attachMeshWebSocket<ClientContext>({
      server,
      path: "/mesh/ws",
      router: router as never,
      verify: (credential) => credential === SECRET,
      context: () => ({}),
      keepAliveMs: 50,
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `ws://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterEach(async () => {
    await gateway.close();
    await new Promise<void>((resolve) => server.close(() => { resolve(); }));
  });

  const clientTo = (credential: string, path = "/mesh/ws") => {
    const link = pooledLink<ClientContext>({
      target: "server",
      maxConnections: 1,
      multiplex: 8,
      idleMs: 1_000,
      open: () => Promise.resolve(openWebSocketConnection({ url: `${origin}${path}?credential=${credential}`, reconnectDelayMs: 10 })),
    });
    return { link, client: createMeshClient<RouterClient<typeof router>>(link) };
  };

  it("answers a call over a real websocket, through a pooled link and an Effect client", async () => {
    const { link, client } = clientTo(SECRET);

    await expect(Effect.runPromise(client.echo({ text: "hello" }))).resolves.toEqual({ text: "hello" });

    await link.closeAll();
  });

  it("streams over the same persistent connection", async () => {
    const { link } = clientTo(SECRET);

    const stream = (await link.call(["count"], { to: 3 }, { context: {} })) as AsyncIterable<number>;
    const received: number[] = [];
    for await (const n of stream) {
      received.push(n);
    }

    expect(received).toEqual([1, 2, 3]);
    await link.closeAll();
  });

  it("serves many calls on one connection", async () => {
    const { link, client } = clientTo(SECRET);

    await Promise.all([1, 2, 3, 4].map((n) => Effect.runPromise(client.echo({ text: String(n) }))));

    expect(gateway.size()).toBe(1);
    await link.closeAll();
  });

  it("refuses a peer without the credential at the upgrade, before any connection exists", async () => {
    const { link, client } = clientTo("wrong");

    await expect(Effect.runPromise(client.echo({ text: "hello" }))).rejects.toBeDefined();

    expect(gateway.size()).toBe(0);
    await link.closeAll();
  });

  it("leaves an upgrade on another path alone", async () => {
    const { link, client } = clientTo(SECRET, "/elsewhere");

    const outcome = await Promise.race([
      Effect.runPromise(client.echo({ text: "hello" })).then(() => "answered"),
      new Promise<string>((resolve) => setTimeout(() => { resolve("ignored"); }, 300)),
    ]).catch(() => "ignored");

    expect(outcome).toBe("ignored");
    expect(gateway.size()).toBe(0);
    await link.closeAll();
  });

  it("drops a peer that stops answering pings", async () => {
    const { link, client } = clientTo(SECRET);
    await Effect.runPromise(client.echo({ text: "hello" }));
    expect(gateway.size()).toBe(1);

    await link.closeAll();
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(gateway.size()).toBe(0);
  });

  describe("trust", () => {
    it("accepts an async verifier, so a service can ask its agent whether a peer is trusted", async () => {
      await gateway.close();
      gateway = attachMeshWebSocket<ClientContext>({
        server,
        path: "/mesh/ws",
        router: router as never,
        verify: (credential) => new Promise((resolve) => setTimeout(() => { resolve(credential === "asked-the-agent"); }, 10)),
        context: () => ({}),
      });

      const trusted = clientTo("asked-the-agent");
      const refused = clientTo("not-it");

      await expect(Effect.runPromise(trusted.client.echo({ text: "hi" }))).resolves.toEqual({ text: "hi" });
      await expect(Effect.runPromise(refused.client.echo({ text: "hi" }))).rejects.toBeDefined();
      await Promise.all([trusted.link.closeAll(), refused.link.closeAll()]);
    });

    it("refuses a peer when the verifier itself fails", async () => {
      await gateway.close();
      gateway = attachMeshWebSocket<ClientContext>({
        server,
        path: "/mesh/ws",
        router: router as never,
        verify: () => Promise.reject(new Error("the agent is down")),
        context: () => ({}),
      });
      const peer = clientTo(SECRET);

      await expect(Effect.runPromise(peer.client.echo({ text: "hi" }))).rejects.toBeDefined();
      await peer.link.closeAll();
    });

    it("serves a unix socket, where the file's permissions are the trust boundary and no credential is carried", async () => {
      const directory = mkdtempSync(join(tmpdir(), "mesh-socket-"));
      const socketPath = join(directory, "agent.sock");
      const local = createServer((_request, response) => response.writeHead(404).end());
      const localGateway = attachMeshWebSocket<ClientContext>({
        server: local,
        path: "/mesh/ws",
        router: router as never,
        verify: () => true,
        context: () => ({}),
      });
      await new Promise<void>((resolve) => local.listen(socketPath, resolve));
      const link = pooledLink<ClientContext>({
        target: socketPath,
        maxConnections: 1,
        multiplex: 4,
        idleMs: 1_000,
        open: () => Promise.resolve(openWebSocketConnection({ url: "ws://agent/mesh/ws", socketPath })),
      });

      const answered = await Effect.runPromise(createMeshClient<RouterClient<typeof router>>(link).echo({ text: "over a socket" }));

      expect(answered).toEqual({ text: "over a socket" });
      await link.closeAll();
      await localGateway.close();
      await new Promise<void>((resolve) => local.close(() => { resolve(); }));
      rmSync(directory, { recursive: true, force: true });
    });
  });
});
