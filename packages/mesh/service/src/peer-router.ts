import { implement } from "@orpc/server";

import { DEFAULT_AGENT_SOCKET, nodeDoor } from "@deployer/mesh-client";

import { meshPeerInfoContract, type MeshPeerInfo } from "./peer-contract";

export type PeerInfoRouterOptions = {
  /** The service this replica belongs to. */
  readonly service: string;
  /** The id the join registered this replica under: the router reports it, it does not invent one. */
  readonly replicaId: string;
  /** The same provider the join hands the heartbeat, so peers see exactly what the directory was told. */
  readonly keys?: () => readonly string[] | Promise<readonly string[]>;
  /** The environment the service runs in. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
};

/** The peer surface every mesh-participating service serves: `peers.info`, from the facts the join holds. */
export function peerInfoRouter(options: PeerInfoRouterOptions) {
  const env = options.env ?? process.env;
  const keys = options.keys ?? (() => []);

  return {
    peers: {
      info: implement(meshPeerInfoContract).handler(
        async (): Promise<MeshPeerInfo> => {
          const status = await nodeDoor({ socketPath: env.NODE_AGENT_SOCKET ?? DEFAULT_AGENT_SOCKET }).status();
          return {
            service: options.service,
            replicaId: options.replicaId,
            // The agent's own identity is the node's mesh id; a restarting agent is a null, not a failed call.
            nodeId: status?.agentId ?? null,
            // The agent's own sample: the same numbers its lease policy reads, so a peer sees the real pressure.
            load: status?.load ?? null,
            keys: [...(await keys())],
          };
        },
      ),
    },
  };
}

