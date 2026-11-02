import { describe, expect, it, vi } from "vitest";

import type { NodeDoorClient } from "@deployer/mesh-client";

import { makeEnvService } from "@/test-support/env";

import { MeshOnboardingService } from "./mesh-onboarding.service";

/**
 * The mesh card's answers. The node door NEVER throws — it resolves `null` when
 * the agent is absent or refuses — so these pin the mapping from "no answer" to
 * the wizard's `available: false` / `joined: false` + reason, which is what
 * keeps a standalone node from looking broken.
 */

/** A door where nothing answers: no agent on this node. */
const silentDoor: NodeDoorClient = {
  status: () => Promise.resolve(null),
  settings: () => Promise.resolve(null),
  view: () => Promise.resolve(null),
  writeSetting: () => Promise.resolve(null),
  issueJoinToken: () => Promise.resolve(null),
  joinWithToken: () => Promise.resolve(null),
  checkJoinToken: () => Promise.resolve(null),
  labels: () => Promise.resolve(null),
  blockNode: () => Promise.resolve(null),
  unblockNode: () => Promise.resolve(null),
};

function makeDoor(overrides: Partial<NodeDoorClient>): NodeDoorClient {
  return { ...silentDoor, ...overrides };
}

function makeService(door: NodeDoorClient = silentDoor): MeshOnboardingService {
  return new MeshOnboardingService(makeEnvService(), door);
}

const status = {
  agentId: "node-a",
  swarmId: "swarm-1",
  load: { eventLoopLagMs: 0, bytesPerSecond: 0, openStreams: 0 },
  interfaceUp: true,
  meshAddress: "10.88.0.2",
  listenPort: 51820,
  peers: [
    { nodeId: "node-b", meshAddress: "10.88.0.3", endpoint: "203.0.113.9:51820", latestHandshakeAt: 1_760_000_000_000 },
    { nodeId: "node-c", meshAddress: null, endpoint: null, latestHandshakeAt: null },
  ],
};

const view = {
  self: { nodeId: "platform-1", address: "10.88.0.2", labels: {}, overlay: null },
  agents: [],
};

describe("MeshOnboardingService", () => {
  describe("getStatus", () => {
    it("maps the agent's status and peers into the wizard's shape", async () => {
      const service = makeService(
        makeDoor({ status: () => Promise.resolve(status), view: () => Promise.resolve(view) }),
      );

      expect(await service.getStatus()).toEqual({
        available: true,
        agentId: "node-a",
        interfaceUp: true,
        meshAddress: "10.88.0.2",
        nodeId: "platform-1",
        swarm: {
          // Two peers plus this node.
          nodes: 3,
          peers: [
            { nodeId: "node-b", meshAddress: "10.88.0.3", handshake: true },
            { nodeId: "node-c", meshAddress: null, handshake: false },
          ],
        },
      });
    });

    it("reports standalone (swarm: null) when the agent has no peers", async () => {
      const service = makeService(
        makeDoor({
          status: () => Promise.resolve({ ...status, peers: [] }),
          view: () => Promise.resolve(view),
        }),
      );

      const result = await service.getStatus();

      expect(result.available).toBe(true);
      expect(result.swarm).toBeNull();
    });

    it("reports unavailable — not an error — when no agent answers", async () => {
      expect(await makeService().getStatus()).toEqual({
        available: false,
        agentId: null,
        interfaceUp: false,
        meshAddress: null,
        nodeId: null,
        swarm: null,
      });
    });
  });

  describe("join", () => {
    const learned = {
      learned: true,
      agents: [
        { nodeId: "node-b", address: "10.88.0.3", labels: {}, overlay: null },
      ],
    };

    it("reports the agents the token taught this node", async () => {
      const service = makeService(makeDoor({ joinWithToken: () => Promise.resolve(learned) }));

      expect(await service.join({ token: "invite" })).toEqual({
        joined: true,
        swarmId: null,
        agents: [{ nodeId: "node-b", address: "10.88.0.3" }],
        reason: null,
      });
    });

    it("returns a human reason when the token is refused", async () => {
      const service = makeService(
        makeDoor({ checkJoinToken: () => Promise.resolve(false) }),
      );

      const result = await service.join({ token: "expired" });

      expect(result.joined).toBe(false);
      expect(result.reason).toMatch(/not valid/i);
    });

    it("distinguishes a valid token the agent failed to redeem", async () => {
      const service = makeService(
        makeDoor({ checkJoinToken: () => Promise.resolve(true) }),
      );

      const result = await service.join({ token: "valid" });

      expect(result.joined).toBe(false);
      expect(result.reason).toMatch(/refused/i);
    });

    it("says the agent is not answering rather than blaming the token", async () => {
      const result = await makeService().join({ token: "invite" });

      expect(result.joined).toBe(false);
      expect(result.reason).toMatch(/not answering/i);
    });
  });

  describe("issueToken", () => {
    it("returns the agent's token", async () => {
      const issueJoinToken = vi.fn(() =>
        Promise.resolve({ token: "invite-1", expiresAt: 1_760_000_000_000 }),
      );
      const service = makeService(makeDoor({ issueJoinToken }));

      expect(await service.issueToken({ ttlMs: 60_000 })).toEqual({ token: "invite-1" });
      expect(issueJoinToken).toHaveBeenCalledWith(60_000);
    });

    it("returns a null token when the agent is silent", async () => {
      expect(await makeService().issueToken({})).toEqual({ token: null });
    });
  });
});
