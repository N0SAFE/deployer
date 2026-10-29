import { Context, Effect } from "effect";

import type { AgentInfo } from "@deployer/mesh-agent-contracts";

import { MeshNoNode } from "../mesh.errors";

import type { ClientContext, ClientLink } from "@orpc/client";

export type KnownAgent = AgentInfo & { readonly link: ClientLink<ClientContext> };

export type NodeAgentsShape = {
  /** The persistent link to another node's agent: the way a call pinned to that node reaches it. */
  readonly linkTo: (nodeId: string) => Effect.Effect<ClientLink<ClientContext>, MeshNoNode>;
  /** Teaches the agent how to reach a node. Roster gossip calls it as agents appear. Returns whether the node was new. */
  readonly know: (agent: KnownAgent) => Effect.Effect<boolean>;
  readonly forget: (nodeId: string) => Effect.Effect<void>;
  /** Every other agent this one can reach, with the address it was learned at. */
  readonly known: () => Effect.Effect<readonly KnownAgent[]>;
};

/** Registry over a given map, so a test starts with the nodes it needs. */
export function nodeAgentsOver(agents: Map<string, KnownAgent>): NodeAgentsShape {
  return {
    linkTo: (nodeId) => {
      const agent = agents.get(nodeId);
      return agent ? Effect.succeed(agent.link) : Effect.fail(new MeshNoNode({ nodeId }));
    },
    know: (agent) =>
      Effect.sync(() => {
        const isNew = !agents.has(agent.nodeId);
        agents.set(agent.nodeId, agent);
        return isNew;
      }),
    forget: (nodeId) => Effect.sync(() => void agents.delete(nodeId)),
    known: () => Effect.sync(() => [...agents.values()]),
  };
}

export class NodeAgents extends Context.Service<NodeAgents, NodeAgentsShape>()("mesh-agent/NodeAgents") {
  /** Starts empty: the other agents are learned from the roster. */
  static readonly live: NodeAgentsShape = nodeAgentsOver(new Map());
}
