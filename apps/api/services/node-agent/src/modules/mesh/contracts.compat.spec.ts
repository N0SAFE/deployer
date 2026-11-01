import { describe, expect, it } from "vitest";

import {
  agentInfoSchema,
  meshCheckInput,
  meshJoinInput,
  meshNodeStatusSchema,
  meshRelayInput,
  meshRevokeInput,
  meshRosterView,
  meshSettingInput,
} from "@deployer/node-agent-contracts";

/**
 * Rolling upgrade, and the input caps that keep one peer (or one caller) from making every agent hold an unbounded
 * payload. Both are contract-level: an agent that refuses here is refusing before anything is stored or forwarded.
 */

const agent = {
  nodeId: "node-a",
  address: "ws://node-a:3106/mesh/ws",
  overlay: null,
  labels: {},
};

describe("meshRosterView", () => {
  it("parses a view from an agent that predates settings and credential epochs", () => {
    // The shape an older agent sends: no `settings`, no `credentialEpoch`, nothing else missing.
    const parsed = meshRosterView.parse({ from: agent, replicas: [], agents: [] });

    expect(parsed.settings).toEqual([]);
    expect(parsed.credentialEpoch).toBe(0);
  });

  it("refuses more replicas, agents or settings than the caps allow", () => {
    const replica = {
      service: "runtime",
      replicaId: "runtime-1",
      nodeId: "node-a",
      address: "ws://runtime-1",
      load: 0,
      keys: [],
      generation: 1,
      expiresAt: 1_000,
    };
    const setting = { key: "node.doors", value: "{}", updatedAt: 1_000 };

    expect(meshRosterView.safeParse({ from: agent, replicas: [replica], agents: [], settings: [] }).success).toBe(true);
    expect(meshRosterView.safeParse({ from: agent, replicas: Array.from({ length: 513 }, () => replica), agents: [] }).success).toBe(false);
    expect(meshRosterView.safeParse({ from: agent, replicas: [], agents: Array.from({ length: 513 }, () => agent) }).success).toBe(false);
    expect(
      meshRosterView.safeParse({ from: agent, replicas: [], agents: [], settings: Array.from({ length: 257 }, () => setting) })
        .success,
    ).toBe(false);
  });
});

describe("meshNodeStatusSchema", () => {
  it("parses the status of an agent that predates the relay counters", () => {
    const status = {
      agentId: "node-a",
      swarmId: null,
      load: { eventLoopLagMs: 0, bytesPerSecond: 0, openStreams: 0 },
      interfaceUp: false,
      meshAddress: null,
      listenPort: 51_820,
      peers: [],
    };

    expect(meshNodeStatusSchema.parse(status).relay).toEqual({ forwarded: 0, noRoute: 0, unreachable: 0 });
    // The advertised address was added after the door: an older agent answers without it, and "" means "not advertised".
    expect(meshNodeStatusSchema.parse(status).advertiseAddress).toBe("");
  });
});

describe("input caps", () => {
  it("caps an agent's address and its labels", () => {
    expect(agentInfoSchema.safeParse({ ...agent, address: "a".repeat(2049) }).success).toBe(false);
    expect(
      agentInfoSchema.safeParse({ ...agent, labels: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${String(i)}`, "v"])) })
        .success,
    ).toBe(false);
    expect(agentInfoSchema.safeParse({ ...agent, labels: { ["k".repeat(65)]: "v" } }).success).toBe(false);
    expect(agentInfoSchema.safeParse({ ...agent, labels: { k: "v".repeat(257) } }).success).toBe(false);
  });

  it("caps a setting's value at 64 KiB", () => {
    expect(meshSettingInput.safeParse({ key: "node.doors", value: "x".repeat(65_536) }).success).toBe(true);
    expect(meshSettingInput.safeParse({ key: "node.doors", value: "x".repeat(65_537) }).success).toBe(false);
  });

  it("caps the token strings", () => {
    const token = "t".repeat(4096);
    expect(meshJoinInput.safeParse({ token }).success).toBe(true);
    expect(meshCheckInput.safeParse({ token }).success).toBe(true);
    expect(meshRevokeInput.safeParse({ token }).success).toBe(true);
    expect(meshJoinInput.safeParse({ token: `${token}t` }).success).toBe(false);
    expect(meshCheckInput.safeParse({ token: `${token}t` }).success).toBe(false);
    expect(meshRevokeInput.safeParse({ token: `${token}t` }).success).toBe(false);
  });

  it("caps a relayed call's path and headers", () => {
    const base = { service: "runtime" };
    expect(meshRelayInput.safeParse({ ...base, path: ["logs", "stream"] }).success).toBe(true);
    expect(meshRelayInput.safeParse({ ...base, path: Array.from({ length: 17 }, () => "x") }).success).toBe(false);
    expect(meshRelayInput.safeParse({ ...base, path: ["x".repeat(129)] }).success).toBe(false);
    expect(meshRelayInput.safeParse({ ...base, path: ["logs"], headers: { cookie: "s".repeat(8192) } }).success).toBe(true);
    expect(meshRelayInput.safeParse({ ...base, path: ["logs"], headers: { cookie: "s".repeat(8193) } }).success).toBe(false);
    expect(
      meshRelayInput.safeParse({
        ...base,
        path: ["logs"],
        headers: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`h${String(i)}`, "v"])),
      }).success,
    ).toBe(false);
  });
});
