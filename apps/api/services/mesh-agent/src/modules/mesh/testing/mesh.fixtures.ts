import { Context, Effect } from "effect";

import {
  MeshDirectoryRepository,
  createDirectoryStore,
  directoryRepositoryOver,
} from "../repositories/directory.repository";
import { AgentLoad, agentLoadOver } from "../services/agent-load.service";
import { MeshBroker } from "../services/broker.service";
import { MeshDirectory } from "../services/directory.service";
import { KeyHints, keyHintsOver } from "../services/key-hints.service";
import { LeaseSigner, leaseSignerOver } from "../services/lease-signer.service";
import { MeshClock } from "../services/mesh-clock.service";
import { NodeAgents, nodeAgentsOver } from "../services/node-agents.service";
import { NodeIdentity } from "../services/node-identity.service";
import { MeshRelay } from "../services/relay.service";
import { ReplicaLinks, type ReplicaLinksShape } from "../services/replica-links.service";

import type { ReplicaRecord } from "../rules/replica-record";
import type { ClientContext, ClientLink } from "@orpc/client";

export type MeshServices =
  | MeshDirectoryRepository
  | NodeIdentity
  | MeshClock
  | MeshDirectory
  | KeyHints
  | MeshBroker
  | MeshRelay
  | NodeAgents
  | ReplicaLinks
  | AgentLoad
  | LeaseSigner;

export const LEASE_SECRET = "mesh-fixture-secret-of-at-least-32-characters";

type Link = ClientLink<ClientContext>;

/** A replica record; tests override only the field under assertion. */
export function replicaRecord(overrides: Partial<ReplicaRecord> = {}): ReplicaRecord {
  return {
    service: "project",
    replicaId: "project-1",
    nodeId: "A",
    address: "http://project-1",
    load: 0.2,
    keys: [],
    generation: 1,
    expiresAt: 11_000,
    ...overrides,
  };
}

/**
 * One agent's world: a node, a clock and an empty directory of its own. Every service is the real one; only the
 * three inputs (repository state, node identity, time) are the test's.
 */
export function meshFixture(
  options: {
    nodeId?: string;
    now?: number;
    /** The link each replica id answers on. A replica with no entry fails with a transport error. */
    replicas?: Record<string, Link>;
    /** The link to each other node's agent. */
    nodes?: Record<string, Link>;
    /** What the agent reports about its own pressure. */
    load?: Partial<{ eventLoopLagMs: number; bytesPerSecond: number; openStreams: number }>;
  } = {},
) {
  const clock = { now: options.now ?? 1_000 };
  const repository = directoryRepositoryOver(createDirectoryStore());
  const hints = keyHintsOver(new Map());
  const links: ReplicaLinksShape = {
    linkTo: (replica) => options.replicas?.[replica.replicaId] ?? { call: () => Promise.reject(new Error(`no link to ${replica.replicaId}`)) },
    evictIdle: () => Promise.resolve(0),
  };
  const load = agentLoadOver({ now: () => clock.now, eventLoopLagMs: () => options.load?.eventLoopLagMs ?? 0 });
  if (options.load?.bytesPerSecond) {
    load.bytesMoved(options.load.bytesPerSecond);
  }
  for (let index = 0; index < (options.load?.openStreams ?? 0); index += 1) {
    load.streamOpened();
  }

  const provide = <A, E>(effect: Effect.Effect<A, E, MeshServices>) =>
    effect.pipe(
      Effect.provideService(MeshDirectoryRepository, repository),
      Effect.provideService(NodeIdentity, { nodeId: options.nodeId ?? "A" }),
      Effect.provideService(MeshClock, { now: () => clock.now }),
      Effect.provideService(MeshDirectory, MeshDirectory.live),
      Effect.provideService(KeyHints, hints),
      Effect.provideService(MeshBroker, MeshBroker.live),
      Effect.provideService(MeshRelay, MeshRelay.live),
      Effect.provideService(NodeAgents, nodeAgentsOver(new Map(Object.entries(options.nodes ?? {})))),
      Effect.provideService(ReplicaLinks, links),
      Effect.provideService(AgentLoad, load),
      Effect.provideService(LeaseSigner, leaseSignerOver({ secret: LEASE_SECRET, ttlMs: 30_000 })),
    );

  const context = Context.empty().pipe(
    Context.add(MeshDirectoryRepository, repository),
    Context.add(NodeIdentity, { nodeId: options.nodeId ?? "A" }),
    Context.add(MeshClock, { now: () => clock.now }),
    Context.add(MeshDirectory, MeshDirectory.live),
    Context.add(KeyHints, hints),
    Context.add(MeshBroker, MeshBroker.live),
    Context.add(MeshRelay, MeshRelay.live),
    Context.add(NodeAgents, nodeAgentsOver(new Map(Object.entries(options.nodes ?? {})))),
    Context.add(ReplicaLinks, links),
    Context.add(AgentLoad, load),
    Context.add(LeaseSigner, leaseSignerOver({ secret: LEASE_SECRET, ttlMs: 30_000 })),
  );

  return {
    clock,
    /** Every service of this agent, as the `effect/context` a controller resolves its handlers against. */
    context,
    /** Stores records exactly as given, as if gossip or an earlier registration had delivered them. */
    seed: (...records: readonly ReplicaRecord[]) =>
      Promise.all(records.map((record) => Effect.runPromise(repository.upsert(record)))),
    run: <A, E>(effect: Effect.Effect<A, E, MeshServices>) => Effect.runPromise(provide(effect)),
    /** The effect's success as `{ value }` or its typed failure as `{ error }`. */
    settle: <A, E>(effect: Effect.Effect<A, E, MeshServices>) =>
      Effect.runPromise(provide(effect).pipe(Effect.match({ onSuccess: (value) => ({ value }), onFailure: (error) => ({ error }) }))),
  };
}
