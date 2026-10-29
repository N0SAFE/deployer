import { Context, Effect } from "effect";

import { MeshNoNode } from "../mesh.errors";

import type { ClientContext, ClientLink } from "@orpc/client";

export type NodeAgentsShape = {
  /** The persistent link to another node's agent: the way a call pinned to that node reaches it. */
  readonly linkTo: (nodeId: string) => Effect.Effect<ClientLink<ClientContext>, MeshNoNode>;
  /** Teaches the agent how to reach a node. Roster gossip calls it as agents appear. */
  readonly know: (nodeId: string, link: ClientLink<ClientContext>) => Effect.Effect<void>;
  readonly forget: (nodeId: string) => Effect.Effect<void>;
};

/** Registry over a given map, so a test starts with the nodes it needs. */
export function nodeAgentsOver(links: Map<string, ClientLink<ClientContext>>): NodeAgentsShape {
  return {
    linkTo: (nodeId) => {
      const link = links.get(nodeId);
      return link ? Effect.succeed(link) : Effect.fail(new MeshNoNode({ nodeId }));
    },
    know: (nodeId, link) => Effect.sync(() => void links.set(nodeId, link)),
    forget: (nodeId) => Effect.sync(() => void links.delete(nodeId)),
  };
}

export class NodeAgents extends Context.Service<NodeAgents, NodeAgentsShape>()("mesh-agent/NodeAgents") {
  /** Starts empty: the other agents are learned from the roster. */
  static readonly live: NodeAgentsShape = nodeAgentsOver(new Map());
}
