import { describe, expect, it } from "vitest";

import { resolveReplica } from "./resolve-replica";

import type { ReplicaRecord } from "./replica-record";

const NOW = 1_000;

function replica(overrides: Partial<ReplicaRecord> & Pick<ReplicaRecord, "replicaId" | "nodeId">): ReplicaRecord {
  return {
    service: "project",
    address: `http://${overrides.replicaId}`,
    load: 0.2,
    keys: [],
    generation: 1,
    expiresAt: NOW + 10_000,
    ...overrides,
  };
}

const project1 = replica({ replicaId: "project-1", nodeId: "A" });
const project2 = replica({ replicaId: "project-2", nodeId: "B" });
const project3 = replica({ replicaId: "project-3", nodeId: "C" });

describe("resolveReplica", () => {
  it("prefers a replica on the agent's own node", () => {
    const resolution = resolveReplica([project1, project2, project3], { service: "project", localNode: "B", now: NOW });

    expect(resolution).toMatchObject({ reason: "local-node", replica: { replicaId: "project-2" } });
  });

  it("serves the replica that holds the key even when another one is local", () => {
    const holder = replica({ replicaId: "project-3", nodeId: "C", keys: ["deploy-7"] });

    const resolution = resolveReplica([project1, project2, holder], {
      service: "project",
      key: "deploy-7",
      localNode: "A",
      now: NOW,
    });

    expect(resolution).toMatchObject({ reason: "key-holder", replica: { replicaId: "project-3" } });
  });

  it("falls back to a key's rendezvous replica when no replica is local", () => {
    const query = { service: "project", key: "deploy-9", localNode: "Z", now: NOW } as const;

    const first = resolveReplica([project1, project2, project3], query);
    const again = resolveReplica([project3, project1, project2], query);

    expect(first?.reason).toBe("affinity");
    expect(again?.replica.replicaId).toBe(first?.replica.replicaId);
  });

  it("keeps a key on its replica when another replica leaves", () => {
    const query = { service: "project", key: "deploy-9", localNode: "Z", now: NOW } as const;
    const owner = resolveReplica([project1, project2, project3], query)?.replica.replicaId;
    const others = [project1, project2, project3].filter((record) => record.replicaId !== owner);
    const survivor = others[0];
    expect(survivor).toBeDefined();

    const after = resolveReplica(
      [project1, project2, project3].filter((record) => record.replicaId !== survivor?.replicaId),
      query,
    );

    expect(after?.replica.replicaId).toBe(owner);
  });

  it("falls back to the least loaded replica when there is no key and none is local", () => {
    const busy = replica({ replicaId: "project-1", nodeId: "A", load: 0.9 });
    const idle = replica({ replicaId: "project-2", nodeId: "B", load: 0.1 });

    const resolution = resolveReplica([busy, idle], { service: "project", localNode: "Z", now: NOW });

    expect(resolution).toMatchObject({ reason: "least-loaded", replica: { replicaId: "project-2" } });
  });

  it("picks the least loaded of several local replicas", () => {
    const busy = replica({ replicaId: "project-1", nodeId: "A", load: 0.9 });
    const idle = replica({ replicaId: "project-1b", nodeId: "A", load: 0.1 });

    const resolution = resolveReplica([busy, idle], { service: "project", localNode: "A", now: NOW });

    expect(resolution?.replica.replicaId).toBe("project-1b");
  });

  it("ignores expired replicas, other services and excluded replicas", () => {
    const expired = replica({ replicaId: "project-1", nodeId: "A", expiresAt: NOW });
    const other = replica({ replicaId: "runtime-1", nodeId: "A", service: "runtime" });

    const resolution = resolveReplica([expired, other, project2, project3], {
      service: "project",
      localNode: "A",
      exclude: ["project-2"],
      now: NOW,
    });

    expect(resolution?.replica.replicaId).toBe("project-3");
  });

  it("returns nothing when no replica is left", () => {
    expect(resolveReplica([project1], { service: "project", localNode: "A", exclude: ["project-1"], now: NOW })).toBeUndefined();
    expect(resolveReplica([], { service: "project", localNode: "A", now: NOW })).toBeUndefined();
  });
});
