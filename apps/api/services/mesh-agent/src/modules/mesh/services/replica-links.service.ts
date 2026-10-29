import { Context } from "effect";

import { type PooledConnection, type PooledLink, pooledLink } from "@deployer/mesh-client";

import type { ReplicaRecord } from "../rules/replica-record";
import type { ClientContext, ClientLink } from "@orpc/client";

export type ReplicaLinksShape = {
  /** The persistent, pooled RPC link to one replica. The same link answers every call to that replica. */
  readonly linkTo: (replica: ReplicaRecord) => ClientLink<ClientContext>;
  /** Closes the links nobody has used for a while. Run it on a timer. */
  readonly evictIdle: () => Promise<number>;
};

const POOL = { maxConnections: 2, multiplex: 64, idleMs: 30_000 } as const;

/** Links to replicas over a given way of connecting, one pool per replica, so a test connects over memory. */
export function replicaLinksOver(connect: (replica: ReplicaRecord) => PooledConnection<ClientContext>): ReplicaLinksShape {
  const links = new Map<string, { address: string; link: PooledLink<ClientContext> }>();

  return {
    linkTo(replica) {
      const known = links.get(replica.replicaId);
      if (known?.address === replica.address) {
        return known.link;
      }
      // A replica that came back on another address gets a new pool; the old one is closed by `evictIdle`.
      void known?.link.closeAll();
      const link = pooledLink<ClientContext>({
        target: replica.replicaId,
        ...POOL,
        open: () => Promise.resolve(connect(replica)),
      });
      links.set(replica.replicaId, { address: replica.address, link });
      return link;
    },
    async evictIdle() {
      let closed = 0;
      for (const [id, entry] of links) {
        closed += await entry.link.evictIdle();
        if (entry.link.size() === 0) {
          links.delete(id);
        }
      }
      return closed;
    },
  };
}

/** Appends the mesh credential the replica's websocket endpoint checks. A websocket cannot carry a header, so it travels in the query. */
export function withCredential(address: string, credential: string): string {
  const url = new URL(address);
  url.searchParams.set("credential", credential);
  return url.toString();
}

export class ReplicaLinks extends Context.Service<ReplicaLinks, ReplicaLinksShape>()("mesh-agent/ReplicaLinks") {}
