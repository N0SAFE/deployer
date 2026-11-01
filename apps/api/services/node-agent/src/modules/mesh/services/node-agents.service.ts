import { Context, Effect } from "effect";

import type { AgentInfo } from "@deployer/node-agent-contracts";

import { MeshNoNode } from "../mesh.errors";

import { AgentLinkFactory } from "./agent-link-factory.service";

import type { ClientContext, ClientLink } from "@orpc/client";

/** An agent this one has learned of. Nothing is connected to it until a call or a gossip round needs it. */
export type KnownAgent = AgentInfo;

export type NodeAgentsShape = {
  /** The link to another node's agent: the way a call pinned to that node reaches it. Opened on first use, then cached. */
  readonly linkTo: (nodeId: string) => Effect.Effect<ClientLink<ClientContext>, MeshNoNode, AgentLinkFactory>;
  /**
   * Teaches the agent how to reach a node. Roster gossip calls it as agents appear, naming the peer it learned the node
   * from. Returns whether the node was new.
   */
  readonly know: (agent: AgentInfo, learnedFrom?: string) => Effect.Effect<boolean>;
  /** Drops a node, the link cached for it, where it was learned from, and any unreachable mark. */
  readonly forget: (nodeId: string) => Effect.Effect<void>;
  /** Every other agent this one can reach, with the address it was learned at. */
  readonly known: () => Effect.Effect<readonly KnownAgent[]>;
  /** The peers that taught this agent where a node answers: the ones that demonstrably exchange with it. */
  readonly sourcesOf: (nodeId: string) => Effect.Effect<readonly string[]>;
  /** Remembers that a node's direct link failed, for `ms`: the next call forwards instead of dialing a dead address. */
  readonly markUnreachable: (nodeId: string, ms: number) => Effect.Effect<void>;
  readonly isUnreachable: (nodeId: string) => Effect.Effect<boolean>;
  readonly clearUnreachable: (nodeId: string) => Effect.Effect<void>;
};

/** Closes a pooled link if it is one; a fake transport has nothing to close. A failed close is not worth an error. */
const closeLink = (link: ClientLink<ClientContext> | undefined) =>
  Effect.promise(async () => {
    if (link !== undefined && "closeAll" in link && typeof link.closeAll === "function") {
      await (link as { closeAll: () => Promise<void> }).closeAll();
    }
  }).pipe(Effect.catch(() => Effect.void));

/**
 * The other agents this one knows: where they answer, the link cached for each, who taught this one about them, and the
 * negative cache that says a direct link failed recently.
 *
 * The four maps are constructor arguments with defaults, so the module provides `NodeAgents.live` with nothing to wire
 * and a spec starts with the nodes it needs: `new NodeAgents.live(new Map([...]))`. A test that needs a fake transport
 * pre-fills `links`; a real agent leaves it empty, so nothing connects until `linkTo` is used.
 */
export class NodeAgents extends Context.Service<NodeAgents, NodeAgentsShape>()("node-agent/NodeAgents") {
  static readonly live = class NodeAgentsImpl implements NodeAgentsShape {
    private readonly agents: Map<string, KnownAgent>;
    private readonly links: Map<string, ClientLink<ClientContext>>;
    private readonly marks: Map<string, number>;
    private readonly sources: Map<string, Set<string>>;

    constructor(
      agents: Map<string, KnownAgent> = new Map(),
      links: Map<string, ClientLink<ClientContext>> = new Map(),
      marks: Map<string, number> = new Map(),
      sources: Map<string, Set<string>> = new Map(),
    ) {
      this.agents = agents;
      this.links = links;
      this.marks = marks;
      this.sources = sources;
    }

    linkTo(nodeId: string) {
      const agents = this.agents;
      const links = this.links;
      return Effect.gen(function* () {
        const cached = links.get(nodeId);
        if (cached !== undefined) return cached;
        const agent = agents.get(nodeId);
        if (agent === undefined) return yield* new MeshNoNode({ nodeId });
        const link = (yield* AgentLinkFactory).linkTo(agent.address);
        links.set(nodeId, link);
        return link;
      });
    }

    know(agent: AgentInfo, learnedFrom?: string) {
      const agents = this.agents;
      const links = this.links;
      const marks = this.marks;
      const sources = this.sources;
      return Effect.sync(() => {
        const isNew = !agents.has(agent.nodeId);
        const previous = agents.get(agent.nodeId);
        // Re-learned at another address: the link cached for the old one is not the way to this node any more, and a
        // failure against the old address says nothing about the new one.
        if (previous !== undefined && previous.address !== agent.address) {
          links.delete(agent.nodeId);
          marks.delete(agent.nodeId);
        }
        agents.set(agent.nodeId, agent);
        if (learnedFrom !== undefined) {
          const from = sources.get(agent.nodeId) ?? new Set<string>();
          from.add(learnedFrom);
          sources.set(agent.nodeId, from);
        }
        return isNew;
      });
    }

    forget(nodeId: string) {
      const agents = this.agents;
      const links = this.links;
      const marks = this.marks;
      const sources = this.sources;
      return Effect.suspend(() => {
        agents.delete(nodeId);
        marks.delete(nodeId);
        sources.delete(nodeId);
        const link = links.get(nodeId);
        links.delete(nodeId);
        return closeLink(link);
      });
    }

    known() {
      const agents = this.agents;
      return Effect.sync(() => [...agents.values()]);
    }

    sourcesOf(nodeId: string) {
      const sources = this.sources;
      return Effect.sync(() => [...(sources.get(nodeId) ?? [])]);
    }

    markUnreachable(nodeId: string, ms: number) {
      const marks = this.marks;
      return Effect.sync(() => {
        marks.set(nodeId, Date.now() + ms);
      });
    }

    isUnreachable(nodeId: string) {
      const marks = this.marks;
      return Effect.sync(() => {
        const until = marks.get(nodeId);
        if (until === undefined) return false;
        if (until > Date.now()) return true;
        marks.delete(nodeId);
        return false;
      });
    }

    clearUnreachable(nodeId: string) {
      const marks = this.marks;
      return Effect.sync(() => {
        marks.delete(nodeId);
      });
    }
  };
}
