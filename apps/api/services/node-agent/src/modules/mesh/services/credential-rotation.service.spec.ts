import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentStore } from "../../../local/agent-store";
import { meshFixture, LEASE_SECRET } from "../testing/mesh.fixtures";
import { CredentialRotation } from "./credential-rotation.service";

import type { ClientContext, ClientLink } from "@orpc/client";

type Link = ClientLink<ClientContext>;

/** A peer that answers the broadcast and remembers what it was told. */
const recordingPeer = () => {
  const calls: { path: string[]; input: unknown }[] = [];
  const link: Link = {
    call: (path, input) => {
      calls.push({ path, input });
      return Promise.resolve({ rotated: true, validUntil: 0, epoch: 0 });
    },
  };
  return { link, calls };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CredentialRotation", () => {
  it("broadcasts the minted secret to every known peer, then installs it locally", async () => {
    const peer = recordingPeer();
    const a = meshFixture({ nodeId: "A", nodes: { B: peer.link } });

    const rotation = await a.run(CredentialRotation.live.rotate());

    expect(peer.calls).toEqual([{ path: ["roster", "rotate"], input: { secret: rotation.secret, validUntil: rotation.validUntil, epoch: rotation.epoch } }]);
    // The same secret every peer was told is the one this agent installs: no second mint.
    expect(a.credential.current()).toBe(rotation.secret);
    expect(a.credential.previous()).toBe(LEASE_SECRET);
    expect(rotation.epoch).toBeGreaterThan(0);
    expect(await a.run(Effect.flatMap(AgentStore, (store) => store.credential()))).toMatchObject({
      secret: rotation.secret,
      previousSecret: LEASE_SECRET,
    });
  });

  it("logs a peer that does not take the rotation, and rotates anyway", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dead: Link = { call: () => Promise.reject(new Error("unreachable")) };
    const peer = recordingPeer();
    const a = meshFixture({ nodeId: "A", nodes: { B: peer.link, Z: dead } });

    const rotation = await a.run(CredentialRotation.live.rotate());

    expect(a.credential.current()).toBe(rotation.secret);
    // The peer that answered still got the secret; the dead one is a warning, not a failure.
    expect(peer.calls).toHaveLength(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Z did not take the rotation"));
  });

  it("adopts a rotation a peer broadcast", async () => {
    const a = meshFixture({ nodeId: "A" });
    const validUntil = Date.now() + 60_000;

    await a.run(CredentialRotation.live.adopt("peer-secret", validUntil, 5_000));

    expect(a.credential.current()).toBe("peer-secret");
    expect(a.credential.previous()).toBe(LEASE_SECRET);
    expect(await a.run(CredentialRotation.live.currentForPeer())).toEqual({
      secret: "peer-secret",
      validUntil,
      epoch: 5_000,
    });
  });
});
