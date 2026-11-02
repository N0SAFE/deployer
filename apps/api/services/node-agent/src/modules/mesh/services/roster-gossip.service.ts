import { ORPCError } from "@orpc/client";
import { Context, Effect, Option } from "effect";

import type { AgentInfo, MeshRosterView } from "@deployer/node-agent-contracts";

import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_GOSSIP_FANOUT } from "../../../config/node-agent.env";
import { AgentStore, type AgentStoreShape, type StoredSetting } from "../../../local/agent-store";
import { SwarmCredential, type SwarmCredentialShape } from "../../../local/swarm-credential";
import { OVERLAY_SELF_SECRET, parseOverlaySelf } from "../../../network/overlay";
import { NodeLabels, type NodeLabelsShape } from "../../node/services/node-labels.service";

import { AgentLinkFactory, type AgentLinkFactoryShape } from "./agent-link-factory.service";
import { MeshDirectory } from "./directory.service";
import { NodeAgents, type KnownAgent, type NodeAgentsShape } from "./node-agents.service";
import { NodeIdentity } from "./node-identity.service";
import { PendingSeeds } from "./pending-seeds.service";

import type { MeshClock } from "./mesh-clock.service";
import type { MeshDirectoryRepository } from "../repositories/directory.repository";

export type SeedResult = {
  /** The seed answered. */
  readonly reached: boolean;
  /** It taught this agent an agent it did not know. */
  readonly learned: boolean;
};

const EXCHANGE_PATH = ["roster", "exchange"];
const CREDENTIAL_PATH = ["roster", "credential"];
/** A peer that stops answering is logged once per this window, whatever the round rate: a warn per round would be noise. */
const PEER_WARN_INTERVAL_MS = 60_000;

/** Where this agent says it can be reached. Provided from the environment; absent when the agent is not advertised yet. */
export class AdvertisedAddress extends Context.Service<AdvertisedAddress, { readonly address: string }>()("node-agent/AdvertisedAddress") {}

/**
 * How many peers one gossip round reaches (`MESH_GOSSIP_FANOUT`, zero meaning everyone), and how long one exchange may
 * take (`NODE_AGENT_CALL_TIMEOUT_MS`) before the peer is treated as gone for this round.
 */
export class GossipSettings extends Context.Service<
  GossipSettings,
  { readonly fanout: number; readonly callTimeoutMs: number }
>()("node-agent/GossipSettings") {
  static readonly live = class GossipSettingsImpl {
    fanout = DEFAULT_GOSSIP_FANOUT
    callTimeoutMs = DEFAULT_CALL_TIMEOUT_MS
  };
}

type GossipDeps =
  | PendingSeeds
  | MeshDirectory
  | NodeAgents
  | NodeIdentity
  | AdvertisedAddress
  | GossipSettings
  | AgentLinkFactory
  | MeshDirectoryRepository
  | MeshClock
  | AgentStore
  | SwarmCredential
  | NodeLabels;

export type RosterGossipShape = {
  /** Answers a peer's exchange: takes in what it knows, returns what this agent knows. */
  readonly exchange: (incoming: MeshRosterView) => Effect.Effect<MeshRosterView, never, GossipDeps>;
  /** One gossip round: exchanges with every known agent, and learns the agents they know of. Returns how many replicas changed. */
  readonly round: () => Effect.Effect<number, never, GossipDeps>;
  /** Learns the mesh from an agent at a known address: the way a fresh agent finds its first peer. */
  readonly seed: (address: string) => Effect.Effect<SeedResult, never, GossipDeps>;
  /**
   * Joins the swarm from now on: remembers the seed, tries it immediately, and keeps retrying it every round until it
   * answers. Everything the agent already holds is sent in the first exchange, so nothing has to be redone.
   */
  readonly join: (address: string) => Effect.Effect<SeedResult & { readonly agents: readonly AgentInfo[] }, never, GossipDeps>;
};

const view: () => Effect.Effect<MeshRosterView, never, GossipDeps> = Effect.fn("RosterGossip.view")(function* () {
  const directory = yield* MeshDirectory;
  const agents = yield* NodeAgents;
  const self = yield* NodeIdentity;
  const advertised = yield* AdvertisedAddress;
  const store = yield* AgentStore;
  const labels = yield* NodeLabels;
  const credential = yield* SwarmCredential;

  const blocked = yield* readBlocked(store);
  const selfLabels = yield* readLabels(labels);
  const replicas = (yield* directory.snapshot()).map((record) => ({ ...record, keys: [...record.keys] }));
  const known = (yield* agents.known())
    .filter((agent) => !blocked.has(agent.nodeId))
    .map(({ nodeId, address, overlay, labels: theirs }) => ({ nodeId, address, overlay, labels: theirs }));
  // The overlay identity is written by the WireGuard pass; an agent that has not run one (or has no keys) advertises none
  // and still takes part in the mesh by address.
  const overlay = parseOverlaySelf(yield* readSecret(store, OVERLAY_SELF_SECRET));
  return {
    from: { nodeId: self.nodeId, address: advertised.address, overlay, labels: selfLabels },
    replicas,
    agents: [{ nodeId: self.nodeId, address: advertised.address, overlay, labels: selfLabels }, ...known],
    // A local store hiccup must not stop gossip: the node keeps the settings it already had, and the next round retries.
    settings: [...(yield* readSettings(store))],
    // When this agent installed its credential: a peer behind it fetches `roster.credential` and converges.
    credentialEpoch: credential.epoch(),
  } satisfies MeshRosterView;
});

/** Takes in a peer's view: its replicas, and every agent it knows of that this one does not. */
const absorb = Effect.fn("RosterGossip.absorb")(function* (incoming: MeshRosterView) {
  const directory = yield* MeshDirectory;
  const agents = yield* NodeAgents;
  const factory = yield* AgentLinkFactory;
  const self = yield* NodeIdentity;
  const store = yield* AgentStore;
  const credential = yield* SwarmCredential;

  // A revoked node is not absorbed at all: neither its replicas nor its agents, whatever credential it presents.
  const blocked = yield* readBlocked(store);
  if (blocked.has(incoming.from.nodeId)) return 0;

  // A rotation this agent missed: the view carries only the epoch, so the credential itself is fetched from the sender
  // while the secret it replaces is still inside its grace window.
  if (incoming.credentialEpoch > credential.epoch()) {
    yield* convergeCredential(factory, incoming.from.address, credential);
  }

  const changed = yield* directory.merge(incoming.replicas.filter((replica) => !blocked.has(replica.nodeId)));

  // Replicated settings: the newest writer wins per key. The stamp is the writer's clock, so an agent's clock must be
  // in sync with the rest of the swarm (a stale clock never wins, which is the safe direction).
  const stored = new Map<string, StoredSetting>();
  for (const setting of yield* readSettings(store)) {
    stored.set(setting.key, setting);
  }
  for (const setting of incoming.settings) {
    const current = stored.get(setting.key);
    if (current === undefined || setting.updatedAt > current.updatedAt) {
      yield* store.putSetting(setting.key, setting.value, setting.updatedAt).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            console.warn(`[node-agent] could not persist ${setting.key} from gossip: ${error.operation}`);
          }),
        ),
      );
    }
  }

  // Learning an agent only records where it answers: its link is opened when a call or a gossip round first needs it.
  // The sender is recorded as the teacher, which is what a forwarding decision later reads as "this peer reaches that
  // node": it demonstrably exchanged with it.
  for (const agent of [incoming.from, ...incoming.agents]) {
    if (agent.nodeId !== self.nodeId && !blocked.has(agent.nodeId)) {
      yield* agents.know(agent, incoming.from.nodeId);
    }
  }
  return changed;
});

/** The last time each peer was reported, so a partition is visible once a minute instead of once a round. */
const peerWarnedAt = new Map<string, number>();

function warnPeerOnce(peer: string, detail: string): void {
  const now = Date.now();
  if (now - (peerWarnedAt.get(peer) ?? Number.NEGATIVE_INFINITY) < PEER_WARN_INTERVAL_MS) return;
  peerWarnedAt.set(peer, now);
  console.warn(`[node-agent] gossip with ${peer} failed: ${detail}; skipping it until its next round`);
}

/**
 * One exchange over `link`. A peer that does not answer — refused, or slower than `callTimeoutMs` — is not an error: it
 * will be asked again next round. It is not silent either: the skip is logged, once per peer per minute.
 */
const exchangeOver = (
  link: { call: (path: string[], input: unknown, options: { context: object }) => Promise<unknown> },
  peer: string,
) =>
  Effect.gen(function* () {
    const settings = yield* GossipSettings;
    const ours = yield* view();
    const theirs = yield* Effect.tryPromise({
      try: () => link.call(EXCHANGE_PATH, ours, { context: {} }) as Promise<MeshRosterView>,
      catch: (error) => (error instanceof ORPCError ? error : new Error(String(error))),
    }).pipe(Effect.timeout(settings.callTimeoutMs));
    return yield* absorb(theirs);
  }).pipe(
    Effect.map((changed): number | undefined => changed),
    Effect.catch((error) =>
      Effect.sync(() => {
        warnPeerOnce(peer, error instanceof Error ? error.message : String(error));
        return undefined;
      }),
    ),
  );

/**
 * The credential a peer is on, adopted when its epoch is ahead. Best effort and bounded: a peer that stalls, or a store
 * that fails, leaves the credential as it was and the next round retries.
 */
const convergeCredential = (
  factory: Pick<AgentLinkFactoryShape, "linkTo">,
  address: string,
  credential: Pick<SwarmCredentialShape, "adopt">,
) =>
  Effect.gen(function* () {
    const settings = yield* GossipSettings;
    const fetched = yield* Effect.tryPromise({
      try: () =>
        factory.linkTo(address).call(CREDENTIAL_PATH, {}, { context: {} }) as Promise<{
          secret: string;
          validUntil: number;
          epoch: number;
        }>,
      catch: (error) => new Error(String(error)),
    }).pipe(Effect.timeout(settings.callTimeoutMs));
    yield* credential.adopt(fetched.secret, fetched.validUntil, fetched.epoch);
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => {
        console.warn("[node-agent] could not fetch the rotated credential from gossip; the next round retries");
      }),
    ),
  );

/** A secret from the store, or undefined when it is absent or unreadable: gossip never stops on a store hiccup. */
const readSecret = (store: { secret: (name: string) => Effect.Effect<string | undefined, { readonly operation: string }> }, name: string) =>
	store.secret(name).pipe(Effect.catch(() => Effect.succeed(undefined)));

/** The nodes this agent refuses, or none when the local store cannot be read: gossip must never stop on a store hiccup. */
const readBlocked = (store: Pick<AgentStoreShape, "blockedNodes">) =>
	store.blockedNodes().pipe(
		Effect.map((nodes) => new Set(nodes)),
		Effect.catch((error) =>
			Effect.sync(() => {
				console.warn(`[node-agent] could not read the blocklist during gossip: ${error.operation}`);
				return new Set<string>();
			}),
		),
	);

/** This node's own labels, or `{}`: a node without labels still takes part in the mesh. */
const readLabels = (labels: Pick<NodeLabelsShape, "read">) =>
	labels.read().pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				console.warn(`[node-agent] could not read the node's labels: ${error.operation}`);
				return {};
			}),
		),
	);

/** The replicated settings, or none when the local store cannot be read: gossip must never stop on a store hiccup. */
const readSettings = (store: {
	settings: () => Effect.Effect<readonly StoredSetting[], { readonly operation: string }>;
}) =>
	store.settings().pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				console.warn(`[node-agent] could not read settings during gossip: ${error.operation}`);
				return [] as readonly StoredSetting[];
			}),
		),
	);

/**
 * Which peers a round exchanges with: `fanout` of them, ordered by node id and taken as a window that moves on by one
 * window every round, wrapping at the end. Successive rounds therefore reach every known agent without repeating a peer
 * until the roster has been walked, while a fleet larger than the fan-out never makes any one agent dial the whole
 * roster. `0` — or a roster no larger than the fan-out — means every known agent, the behaviour a small mesh wants.
 */
const gossipPeers = (known: readonly KnownAgent[], fanout: number, round: number): readonly KnownAgent[] => {
  const ordered = [...known].sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (fanout <= 0 || fanout >= ordered.length) return ordered;
  const start = (round * fanout) % ordered.length;
  const peers: KnownAgent[] = [];
  for (let offset = 0; offset < fanout; offset += 1) {
    const peer = ordered[(start + offset) % ordered.length];
    if (peer !== undefined) peers.push(peer);
  }
  return peers;
};

/**
 * How many rounds this registry has run. It is keyed by the registry, not by the process, so two agents in one test keep
 * their own rotation (and a test that builds five peers always starts at the first one).
 */
const roundCounts = new WeakMap<NodeAgentsShape, number>();

const nextRound = (agents: NodeAgentsShape): number => {
  const round = roundCounts.get(agents) ?? 0;
  roundCounts.set(agents, round + 1);
  return round;
};

/**
 * How the agents learn about each other and about every replica: periodic, symmetric exchanges of what each knows.
 *
 * One reachable seed is enough, because an exchange also carries the agents the peer knows of, so a fresh agent finds
 * the whole mesh through it. Replicas of a node are only ever taken from gossip for OTHER nodes: this agent is the
 * authority for its own, and expiry ages out a node that stopped being gossiped.
 */
export class RosterGossip extends Context.Service<RosterGossip, RosterGossipShape>()("node-agent/RosterGossip") {
  static readonly live = class RosterGossipImpl implements RosterGossipShape {
    exchange(incoming: MeshRosterView): ReturnType<RosterGossipShape["exchange"]> {
      return Effect.gen(function* () {
        yield* absorb(incoming);
        return yield* view();
      });
    }

    round() {
      return Effect.gen(function* () {
        const agents = yield* NodeAgents;
        const settings = yield* GossipSettings;
        const peers = gossipPeers(yield* agents.known(), settings.fanout, nextRound(agents));
        let changed = 0;
        for (const peer of peers) {
          // A peer forgotten between the snapshot and the call is simply skipped: the next round sees the registry afresh.
          const link = yield* agents.linkTo(peer.nodeId).pipe(Effect.option);
          if (Option.isSome(link)) {
            changed += (yield* exchangeOver(link.value, peer.nodeId)) ?? 0;
          }
        }
        return changed;
      });
    }

    seed(address: string) {
      return Effect.gen(function* () {
        const factory = yield* AgentLinkFactory;
        const agents = yield* NodeAgents;
        const before = (yield* agents.known()).length;
        const outcome = yield* exchangeOver(factory.linkTo(address), address);
        return { reached: outcome !== undefined, learned: (yield* agents.known()).length > before } satisfies SeedResult;
      });
    }

    join(address: string) {
      const seed = this.seed;
      return Effect.gen(function* () {
        const seeds = yield* PendingSeeds;
        yield* seeds.add(address);
        const result = yield* seed(address);
        if (result.reached) {
          yield* seeds.reached(address);
        }
        const known = yield* (yield* NodeAgents).known();
        return {
          ...result,
          agents: known.map(({ nodeId, address: where, overlay, labels }) => ({ nodeId, address: where, overlay, labels })),
        };
      });
    }
  };
}
