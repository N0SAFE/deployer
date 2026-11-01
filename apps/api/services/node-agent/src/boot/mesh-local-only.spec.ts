import { statSync } from "node:fs";

import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vitest";

import { type nodeAgentContract } from "@deployer/node-agent-contracts";
import { ROTATION_GRACE_MS } from "@/local/swarm-credential";
import { agentLink, createMeshClient, openWebSocketConnection, pooledLink } from "@deployer/mesh-client";

import { openAgentStore } from "@/local/agent-store";

import { type BootedAgent, bootAgent, removeDataDir } from "./boot-agent";

import type { ContractRouterClient } from "@orpc/contract";
import type { ClientContext } from "@orpc/client";

type NodeAgentClient = ContractRouterClient<typeof nodeAgentContract>;

const EPOCH_WINDOW_MS = 5 * 60 * 1_000;
const NEW_SECRET = "mesh-local-only-spec-secret-of-32-chars-or-more";

/**
 * The node door is the only door that may join a swarm or write a setting. The peer websocket is behind the swarm's
 * credential and the HTTP surface serves health only, so neither may make this node someone else's: a peer replicates
 * settings by gossip, never by a write.
 */
describe("privileged roster procedures over the wrong door", () => {
  const running: BootedAgent[] = [];
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(running.map((agent) => agent.stop().catch(() => undefined)));
    dirs.forEach(removeDataDir);
  });

  async function boot(): Promise<BootedAgent> {
    const agent = await bootAgent();
    running.push(agent);
    dirs.push(agent.dataDir);
    return agent;
  }

  /** The service door: what a service container on the node can open. */
  const local = (agent: BootedAgent) =>
    createMeshClient<NodeAgentClient>(agentLink(agent.transport.localSocketPath));

  /** The admin door: what only the operator-facing processes mount (mode 0600). */
  const admin = (agent: BootedAgent) =>
    createMeshClient<NodeAgentClient>(agentLink(agent.transport.adminSocketPath));

  const peer = (agent: BootedAgent, credential: string) =>
    createMeshClient<NodeAgentClient>(
      pooledLink<ClientContext>({
        target: agent.ws,
        maxConnections: 1,
        multiplex: 4,
        idleMs: 1_000,
        open: () =>
          Promise.resolve(openWebSocketConnection({ url: `${agent.ws}?credential=${credential}`, reconnectDelayMs: 20 })),
      }),
    );

  async function credentialOf(agent: BootedAgent): Promise<string> {
    const store = await openAgentStore(agent.dataDir);
    const { secret } = await Effect.runPromise(store.credential());
    await Effect.runPromise(store.close());
    return secret;
  }

  const post = async (agent: BootedAgent, path: string) => fetch(`${agent.http}${path}`, { method: "POST" });

  describe("roster.join", () => {
    it("has no HTTP route at all, even with the swarm's credential and a valid token", async () => {
      const agent = await boot();

      const refused = await post(agent, "/mesh/roster/join");

      expect(refused.status).toBe(404);
    });

    it("is refused on the mesh websocket, even with the swarm's credential", async () => {
      const agent = await boot();
      const secret = await credentialOf(agent);
      const { token } = await Effect.runPromise(admin(agent).roster.token({ ttlMs: 60_000 }));

      await expect(Effect.runPromise(peer(agent, secret).roster.join({ token }))).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });

    it("works on the node's own socket", async () => {
      const a = await boot();
      const b = await boot();
      const { token } = await Effect.runPromise(admin(a).roster.token({ ttlMs: 60_000 }));

      const joined = await Effect.runPromise(admin(b).roster.join({ token }));

      expect(joined).toMatchObject({ learned: true });
      expect(await credentialOf(b)).toBe(await credentialOf(a));
    });
  });

  describe("roster.setting", () => {
    it("has no HTTP route and is refused on the mesh websocket", async () => {
      const agent = await boot();
      const secret = await credentialOf(agent);

      const http = await post(agent, "/mesh/roster/setting");
      expect(http.status).toBe(404);

      await expect(
        Effect.runPromise(peer(agent, secret).roster.setting({ key: "spec.setting", value: "\"peer\"" })),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      expect(await Effect.runPromise(local(agent).node.settings({}))).toEqual({ settings: [] });
    });

    it("is written on the node's own socket", async () => {
      const agent = await boot();

      const written = await Effect.runPromise(local(agent).roster.setting({ key: "spec.setting", value: "\"local\"" }));

      expect(written).toMatchObject({ key: "spec.setting", value: "\"local\"" });
      expect((await Effect.runPromise(local(agent).node.settings({}))).settings).toMatchObject([
        { key: "spec.setting", value: "\"local\"" },
      ]);
    });
  });

  /**
   * A rotation is broadcast by a peer, so its payload is not trusted: the adopter clamps the window and the epoch to
   * what it will accept. A past or absent window must not lock the peer out of its own swarm.
   */
  describe("roster.rotate adopts a clamped window", () => {
    it("turns a past validUntil into the full grace", async () => {
      const agent = await boot();
      const before = Date.now();

      const result = await Effect.runPromise(
        admin(agent).roster.rotate({ secret: NEW_SECRET, validUntil: before - 60_000, epoch: before }),
      );

      expect(result.validUntil).toBeGreaterThanOrEqual(before + ROTATION_GRACE_MS - 5_000);
      expect(result.validUntil).toBeLessThanOrEqual(Date.now() + ROTATION_GRACE_MS);
    });

    it("clamps a far-future validUntil to the grace", async () => {
      const agent = await boot();
      const before = Date.now();

      const result = await Effect.runPromise(
        admin(agent).roster.rotate({ secret: NEW_SECRET, validUntil: before + 10 * 365 * 24 * 60 * 60 * 1_000, epoch: before }),
      );

      expect(result.validUntil).toBeLessThanOrEqual(Date.now() + ROTATION_GRACE_MS);
      expect(result.validUntil).toBeGreaterThanOrEqual(before + ROTATION_GRACE_MS - 5_000);
    });

    it("clamps an epoch absurdly far from this node's clock", async () => {
      const agent = await boot();

      const result = await Effect.runPromise(admin(agent).roster.rotate({ secret: NEW_SECRET, epoch: 1 }));
      const now = Date.now();

      expect(result.epoch).toBeGreaterThanOrEqual(now - EPOCH_WINDOW_MS);
      expect(result.epoch).toBeLessThanOrEqual(now + EPOCH_WINDOW_MS);
      expect(result.epoch).toBeGreaterThan(1);
    });
  });

  /**
   * F-06: two sockets, two audiences. A service container mounts the 0660 socket and can only reach the procedures named in
   * `SERVICE_DOOR_PROCEDURES`; rotating the swarm secret, issuing or redeeming a token, cutting a member off and
   * reconfiguring the node live on the 0600 admin socket, which a deployment mounts only into the processes that perform
   * operator actions.
   */
  describe("the service and admin doors", () => {
    it("mode-owns the sockets: 0660 for services, 0600 for the admin door", async () => {
      const agent = await boot();

      expect(statSync(agent.transport.localSocketPath).mode & 0o777).toBe(0o660);
      expect(statSync(agent.transport.adminSocketPath).mode & 0o777).toBe(0o600);
    });

    it("serves the operator procedures on the admin door", async () => {
      const agent = await boot();

      await expect(Effect.runPromise(admin(agent).roster.token({ ttlMs: 60_000 }))).resolves.toMatchObject({
        token: expect.any(String),
      });
      await expect(Effect.runPromise(admin(agent).node.settings({}))).resolves.toEqual({ settings: [] });
    });

    it("refuses every operator procedure on the service door", async () => {
      const agent = await boot();
      const service = local(agent);

      const calls: (() => Effect.Effect<unknown, unknown>)[] = [
        () => service.roster.token({}),
        () => service.roster.join({ token: "x" }),
        () => service.roster.rotate({}),
        () => service.roster.credential({}),
        () => service.roster.revoke({ token: "x" }),
        () => service.roster.block({ nodeId: "node-b" }),
        () => service.roster.unblock({ nodeId: "node-b" }),
        () => service.roster.exchange({} as never),
        () => service.node.configure({}),
      ];
      for (const call of calls) {
        // Not a procedure at all on this door: oRPC answers that no procedure matched, which is the door refusing by
        // omission (a FORBIDDEN would mean the door serves it and the handler had to say no).
        await expect(Effect.runPromise(call())).rejects.toThrow(/No procedure matched/);
      }
    });
  });
});
