import { describe, expect, it } from "vitest";

import { signLease } from "../rules/lease-token";
import { LEASE_SECRET, meshFixture } from "../testing/mesh.fixtures";

import { AccessChecks } from "./access-checks.service";

describe("AccessChecks", () => {
  const grant = (overrides: { replicaId?: string; expiresAt?: number; secret?: string } = {}) =>
    signLease({ replicaId: overrides.replicaId ?? "runtime-1", callerId: "mesh-peer", expiresAt: overrides.expiresAt ?? 10_000 }, overrides.secret ?? LEASE_SECRET);

  it("accepts the swarm's credential, as another agent relaying a call presents it", async () => {
    const mesh = meshFixture();

    expect(await mesh.run(new AccessChecks.live().verify(LEASE_SECRET, "runtime-1"))).toBe(true);
  });

  it("accepts a direct grant that names this replica and has not expired", async () => {
    const mesh = meshFixture({ now: 1_000 });

    expect(await mesh.run(new AccessChecks.live().verify(grant(), "runtime-1"))).toBe(true);
  });

  it.each([
    ["a grant for another replica", () => grant({ replicaId: "runtime-2" })],
    ["an expired grant", () => grant({ expiresAt: 1_000 })],
    ["a grant signed with another secret", () => grant({ secret: "someone-elses-secret" })],
    ["a guess", () => "guess"],
  ])("refuses %s", async (_name, presented) => {
    const mesh = meshFixture({ now: 1_000 });

    expect(await mesh.run(new AccessChecks.live().verify(presented(), "runtime-1"))).toBe(false);
  });

  it("follows a credential replaced by a join: the old one stops being good at once", async () => {
    const mesh = meshFixture();
    const before = await mesh.run(new AccessChecks.live().verify(LEASE_SECRET, "runtime-1"));

    await mesh.run(mesh.credential.install("the-swarm-secret", "swarm-1"));

    expect(before).toBe(true);
    expect(await mesh.run(new AccessChecks.live().verify(LEASE_SECRET, "runtime-1"))).toBe(false);
    expect(await mesh.run(new AccessChecks.live().verify("the-swarm-secret", "runtime-1"))).toBe(true);
  });
});
