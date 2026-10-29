import { DatabaseSync } from "node:sqlite";

import { Context, Effect } from "effect";

import { AgentStore, agentStoreOver } from "../../../local/agent-store";
import { SwarmCredential, swarmCredentialFrom } from "../../../local/swarm-credential";
import {
  MeshDirectoryRepository,
  createDirectoryStore,
  directoryRepositoryOver,
} from "../repositories/directory.repository";
import { AccessChecks } from "../services/access-checks.service";
import { AgentLinkFactory, agentLinkFactoryOver } from "../services/agent-link-factory.service";
import { AgentLoad, agentLoadOver } from "../services/agent-load.service";
import { MeshBroker } from "../services/broker.service";
import { MeshDirectory } from "../services/directory.service";
import { JoinTokens } from "../services/join-tokens.service";
import { KeyHints, keyHintsOver } from "../services/key-hints.service";
import { LeaseSigner, leaseSignerOver } from "../services/lease-signer.service";
import { MeshClock } from "../services/mesh-clock.service";
import { NodeAgents, nodeAgentsOver } from "../services/node-agents.service";
import { NodeIdentity } from "../services/node-identity.service";
import { PendingSeeds, pendingSeedsOver } from "../services/pending-seeds.service";
import { MeshRelay } from "../services/relay.service";
import { ReplicaLinks, type ReplicaLinksShape } from "../services/replica-links.service";
import { AdvertisedAddress, RosterGossip } from "../services/roster-gossip.service";

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
  | LeaseSigner
  | RosterGossip
  | AdvertisedAddress
  | AgentLinkFactory
  | PendingSeeds
  | AgentStore
  | SwarmCredential
  | JoinTokens
  | AccessChecks;

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
    /** The agent a link to each address reaches: how this agent connects to an agent it learned of by address. */
    addresses?: Record<string, Link>;
    /** Where this agent says it can be reached. */
    advertise?: string;
    /** The credential this agent starts with: its own until it joins a swarm. */
    secret?: string;
    /** The swarm it already belongs to. */
    swarmId?: string;
    /** What the agent reports about its own pressure. */
    load?: Partial<{ eventLoopLagMs: number; bytesPerSecond: number; openStreams: number }>;
  } = {},
) {
  const clock = { now: options.now ?? 1_000 };
  const repository = directoryRepositoryOver(createDirectoryStore());
  const hints = keyHintsOver(new Map());
  const pendingSeeds = pendingSeedsOver(new Set());
  const store = agentStoreOver(new DatabaseSync(":memory:") as never, () => clock.now);
  const credential = swarmCredentialFrom({ secret: options.secret ?? LEASE_SECRET, swarmId: options.swarmId ?? null });
  const nodeAgents = nodeAgentsOver(new Map(Object.entries(options.nodes ?? {}).map(([nodeId, link]) => [nodeId, { nodeId, address: `ws://${nodeId}`, link }])));
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
      Effect.provideService(NodeAgents, nodeAgents),
      Effect.provideService(ReplicaLinks, links),
      Effect.provideService(AgentLoad, load),
      Effect.provideService(LeaseSigner, leaseSignerOver({ secret: LEASE_SECRET, ttlMs: 30_000 })),
      Effect.provideService(RosterGossip, RosterGossip.live),
      Effect.provideService(AdvertisedAddress, advertised),
      Effect.provideService(AgentLinkFactory, agentLinks),
      Effect.provideService(PendingSeeds, pendingSeeds),
      Effect.provideService(AgentStore, store),
      Effect.provideService(SwarmCredential, credential),
      Effect.provideService(JoinTokens, JoinTokens.live),
      Effect.provideService(AccessChecks, AccessChecks.live),
    );

  const advertised = { address: options.advertise ?? `ws://${options.nodeId ?? "A"}` };
  const agentLinks = agentLinkFactoryOver((address) => ({
    link: options.addresses?.[address] ?? { call: () => Promise.reject(new Error(`no agent at ${address}`)) },
    close: () => Promise.resolve(),
    healthy: () => true,
  }));

  const context = Context.empty().pipe(
    Context.add(MeshDirectoryRepository, repository),
    Context.add(NodeIdentity, { nodeId: options.nodeId ?? "A" }),
    Context.add(MeshClock, { now: () => clock.now }),
    Context.add(MeshDirectory, MeshDirectory.live),
    Context.add(KeyHints, hints),
    Context.add(MeshBroker, MeshBroker.live),
    Context.add(MeshRelay, MeshRelay.live),
    Context.add(NodeAgents, nodeAgents),
    Context.add(ReplicaLinks, links),
    Context.add(AgentLoad, load),
    Context.add(LeaseSigner, leaseSignerOver({ secret: LEASE_SECRET, ttlMs: 30_000 })),
    Context.add(RosterGossip, RosterGossip.live),
    Context.add(AdvertisedAddress, advertised),
    Context.add(AgentLinkFactory, agentLinks),
    Context.add(PendingSeeds, pendingSeeds),
    Context.add(AgentStore, store),
    Context.add(SwarmCredential, credential),
    Context.add(JoinTokens, JoinTokens.live),
    Context.add(AccessChecks, AccessChecks.live),
  );

  return {
    clock,
    /** Every service of this agent, as the `effect/context` a controller resolves its handlers against. */
    context,
    /** The agent's own store and credential, to see what a join left behind. */
    store,
    credential,
    /** Stores records exactly as given, as if gossip or an earlier registration had delivered them. */
    seed: (...records: readonly ReplicaRecord[]) =>
      Promise.all(records.map((record) => Effect.runPromise(repository.upsert(record)))),
    run: <A, E>(effect: Effect.Effect<A, E, MeshServices>) => Effect.runPromise(provide(effect)),
    /** The effect's success as `{ value }` or its typed failure as `{ error }`. */
    settle: <A, E>(effect: Effect.Effect<A, E, MeshServices>) =>
      Effect.runPromise(provide(effect).pipe(Effect.match({ onSuccess: (value) => ({ value }), onFailure: (error) => ({ error }) }))),
  };
}
