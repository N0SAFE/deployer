import { ORPCError } from "@orpc/client";
import { Context, Effect } from "effect";

import type { AgentInfo, MeshRosterView } from "@deployer/mesh-agent-contracts";

import { AgentLinkFactory } from "./agent-link-factory.service";
import { MeshDirectory } from "./directory.service";
import { NodeAgents } from "./node-agents.service";
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

/** Where this agent says it can be reached. Provided from the environment; absent when the agent is not advertised yet. */
export class AdvertisedAddress extends Context.Service<AdvertisedAddress, { readonly address: string }>()("mesh-agent/AdvertisedAddress") {}

type GossipDeps = PendingSeeds | MeshDirectory | NodeAgents | NodeIdentity | AdvertisedAddress | AgentLinkFactory | MeshDirectoryRepository | MeshClock;

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

const view = Effect.fn("RosterGossip.view")(function* () {
  const directory = yield* MeshDirectory;
  const agents = yield* NodeAgents;
  const self = yield* NodeIdentity;
  const advertised = yield* AdvertisedAddress;

  const replicas = (yield* directory.snapshot()).map((record) => ({ ...record, keys: [...record.keys] }));
  const known = (yield* agents.known()).map(({ nodeId, address }) => ({ nodeId, address }));
  return {
    from: { nodeId: self.nodeId, address: advertised.address },
    replicas,
    agents: [{ nodeId: self.nodeId, address: advertised.address }, ...known],
  } satisfies MeshRosterView;
});

/** Takes in a peer's view: its replicas, and every agent it knows of that this one does not. */
const absorb = Effect.fn("RosterGossip.absorb")(function* (incoming: MeshRosterView) {
  const directory = yield* MeshDirectory;
  const agents = yield* NodeAgents;
  const factory = yield* AgentLinkFactory;
  const self = yield* NodeIdentity;

  const changed = yield* directory.merge(incoming.replicas);
  for (const agent of [incoming.from, ...incoming.agents]) {
    if (agent.nodeId !== self.nodeId) {
      const known = yield* agents.known();
      if (!known.some((existing) => existing.nodeId === agent.nodeId && existing.address === agent.address)) {
        yield* agents.know({ ...agent, link: factory.linkTo(agent.address) });
      }
    }
  }
  return changed;
});

/** One exchange over `link`. A peer that does not answer is not an error: it will be asked again next round. */
const exchangeOver = (link: { call: (path: string[], input: unknown, options: { context: object }) => Promise<unknown> }) =>
  Effect.gen(function* () {
    const ours = yield* view();
    const theirs = yield* Effect.tryPromise({
      try: () => link.call(EXCHANGE_PATH, ours, { context: {} }) as Promise<MeshRosterView>,
      catch: (error) => (error instanceof ORPCError ? error : new Error(String(error))),
    });
    return yield* absorb(theirs);
  }).pipe(
    Effect.map((changed): number | undefined => changed),
    Effect.catch(() => Effect.succeed<number | undefined>(undefined)),
  );

/**
 * How the agents learn about each other and about every replica: periodic, symmetric exchanges of what each knows.
 *
 * One reachable seed is enough, because an exchange also carries the agents the peer knows of, so a fresh agent finds
 * the whole mesh through it. Replicas of a node are only ever taken from gossip for OTHER nodes: this agent is the
 * authority for its own, and expiry ages out a node that stopped being gossiped.
 */
export class RosterGossip extends Context.Service<RosterGossip, RosterGossipShape>()("mesh-agent/RosterGossip") {
  static readonly live: RosterGossipShape = {
    exchange: Effect.fn("RosterGossip.exchange")(function* (incoming: MeshRosterView) {
      yield* absorb(incoming);
      return yield* view();
    }),

    round: Effect.fn("RosterGossip.round")(function* () {
      const agents = yield* NodeAgents;
      let changed = 0;
      for (const agent of yield* agents.known()) {
        changed += (yield* exchangeOver(agent.link)) ?? 0;
      }
      return changed;
    }),

    seed: Effect.fn("RosterGossip.seed")(function* (address: string) {
      const factory = yield* AgentLinkFactory;
      const agents = yield* NodeAgents;
      const before = (yield* agents.known()).length;
      const outcome = yield* exchangeOver(factory.linkTo(address));
      return { reached: outcome !== undefined, learned: (yield* agents.known()).length > before } satisfies SeedResult;
    }),

    join: Effect.fn("RosterGossip.join")(function* (address: string) {
      const seeds = yield* PendingSeeds;
      yield* seeds.add(address);
      const result = yield* RosterGossip.live.seed(address);
      if (result.reached) {
        yield* seeds.reached(address);
      }
      const known = yield* (yield* NodeAgents).known();
      return { ...result, agents: known.map(({ nodeId, address: where }) => ({ nodeId, address: where })) };
    }),
  };
}
