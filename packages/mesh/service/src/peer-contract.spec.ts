import { describe, expect, it } from "vitest";

import { meshPeerInfoContract, meshPeerInfoSchema } from "./peer-contract";

describe("meshPeerInfoSchema", () => {
  it("describes a replica: its service, its registered id, its node, its load and its keys", () => {
    const info = {
      service: "project",
      replicaId: "project-host-a",
      nodeId: "node-a",
      load: { eventLoopLagMs: 12, bytesPerSecond: 2_048, openStreams: 3 },
      keys: ["project:p-1", "project:p-2"],
    };

    expect(meshPeerInfoSchema.parse(info)).toEqual(info);
  });

  it("lets a replica say it does not know its node, or that nobody measures its load", () => {
    expect(
      meshPeerInfoSchema.parse({ service: "fleet", replicaId: "fleet-a", nodeId: null, load: null, keys: [] }),
    ).toEqual({ service: "fleet", replicaId: "fleet-a", nodeId: null, load: null, keys: [] });
  });

  it("refuses a replica that reports no id, or a load pieced together from nothing", () => {
    expect(meshPeerInfoSchema.safeParse({ service: "fleet", replicaId: "", nodeId: null, load: null, keys: [] }).success).toBe(false);
    expect(
      meshPeerInfoSchema.safeParse({ service: "fleet", replicaId: "fleet-a", nodeId: null, load: { eventLoopLagMs: 1 }, keys: [] }).success,
    ).toBe(false);
  });
});

describe("meshPeerInfoContract", () => {
  it("is a mesh-only read: no method or path, so it cannot be mounted as an HTTP route", () => {
    const meta = (meshPeerInfoContract as unknown as { "~orpc": { meta: Record<string, unknown> } })["~orpc"].meta;

    expect(meta).not.toHaveProperty("method");
    expect(meta).not.toHaveProperty("path");
  });

  it("takes no input and answers a replica", () => {
    const input = (meshPeerInfoContract as unknown as { "~orpc": { inputSchemas: readonly { parse: (value: unknown) => unknown }[] } })["~orpc"]
      .inputSchemas[0];

    expect(input?.parse({})).toEqual({});
  });
});
