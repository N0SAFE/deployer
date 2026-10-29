/** One replica of a service as the directory knows it. Gossiped between agents, so it is plain data. */
export type ReplicaRecord = {
  readonly service: string;
  readonly replicaId: string;
  readonly nodeId: string;
  /** Where the replica's RPC endpoint answers on the overlay network. */
  readonly address: string;
  /** 0 (idle) to 1 (saturated). */
  readonly load: number;
  /** The resources this replica currently holds in memory (a deployment, a terminal session, a stream). */
  readonly keys: readonly string[];
  /** Bumped by the replica on every registration; the higher generation wins a merge. */
  readonly generation: number;
  /** Epoch ms after which the record is dead. A silent replica's keys age out through this. */
  readonly expiresAt: number;
};

export type ResolveReason = "key-holder" | "local-node" | "affinity" | "least-loaded";

export type Resolution = {
  readonly replica: ReplicaRecord;
  readonly reason: ResolveReason;
};

export type ResolveQuery = {
  readonly service: string;
  /** The resource the caller needs, when it knows one. */
  readonly key?: string;
  /** The node of the agent resolving: locality is relative to it. */
  readonly localNode: string;
  /** Replicas the caller already tried; never returned. */
  readonly exclude?: readonly string[];
  /** Serve only from the agent's own node: a call that was pinned to this node never leaves it. */
  readonly localOnly?: boolean;
  readonly now: number;
};
