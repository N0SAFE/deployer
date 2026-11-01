import { Context } from "effect";

import { type PooledConnection, type PooledLink, pooledLink } from "@deployer/mesh-client";

import type { ClientContext, ClientLink } from "@orpc/client";

export type AgentLinkFactoryShape = {
  /** The persistent, pooled RPC link to the agent that answers at `address`. One pool per address. */
  readonly linkTo: (address: string) => ClientLink<ClientContext>;
  /** Closes the links nobody has used for a while and forgets them. Run it on a timer. */
  readonly evictIdle?: () => Promise<number>;
};

/** Links to agents over a given way of connecting, so a test connects over memory. */
export function agentLinkFactoryOver(connect: (address: string) => PooledConnection<ClientContext>): AgentLinkFactoryShape {
  const links = new Map<string, PooledLink<ClientContext>>();
  return {
    linkTo(address) {
      const known = links.get(address);
      if (known) {
        return known;
      }
      const link = pooledLink<ClientContext>({
        target: address,
        maxConnections: 2,
        multiplex: 64,
        idleMs: 60_000,
        open: () => Promise.resolve(connect(address)),
      });
      links.set(address, link);
      return link;
    },
    async evictIdle() {
      let closed = 0;
      for (const [address, link] of links) {
        closed += await link.evictIdle();
        if (link.size() === 0) {
          links.delete(address);
        }
      }
      return closed;
    },
  };
}

export class AgentLinkFactory extends Context.Service<AgentLinkFactory, AgentLinkFactoryShape>()("node-agent/AgentLinkFactory") {}
