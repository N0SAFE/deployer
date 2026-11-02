import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { replicaSchema } from "../directory/replica";

import { meshSettingSchema } from "./setting";

/**
 * What a node needs to be reachable over the WireGuard overlay: its public key, its address inside the overlay, and the
 * endpoint the other nodes dial. Null on a node whose agent has no overlay yet (no keys, no kernel interface): the node
 * still takes part in the mesh by address, it just does not join the encrypted network.
 */
export const agentOverlaySchema = z.object({
  wireguardKey: z.string().min(1),
  meshAddress: z.string().min(1),
  /** `host:port` of this node's WireGuard listener. */
  endpoint: z.string().min(1),
  listenPort: z.number().int().min(1).max(65_535),
});

/**
 * The most labels one node may publish, and the longest key and value: a label is a routing hint, not a payload, so a
 * peer that sends more is refused at the contract rather than stored.
 */
const MAX_LABELS = 32;

/** An agent as the others reach it: its node, where its websocket answers, and its overlay identity when it has one. */
export const agentInfoSchema = z.object({
  nodeId: z.string().min(1),
  /** A websocket URL, or a bare `host:port`: bounded so a peer cannot make this agent store an unbounded string. */
  address: z.string().min(1).max(2048),
  overlay: agentOverlaySchema.nullable(),
  /**
   * Facts about the node, published by its own services (`node.labels` writes them, the API sets `deployer.node-id`).
   * Defaulted so an agent that predates labels still parses.
   */
  labels: z
    .record(z.string().max(64), z.string().max(256))
    .refine((labels) => Object.keys(labels).length <= MAX_LABELS, `at most ${String(MAX_LABELS)} labels`)
    .default({}),
});

/**
 * What an agent knows, sent to a peer and answered with the peer's own: the replicas it has, and the agents it can
 * reach. Gossip is symmetric, so one exchange teaches both sides, and an agent that only knows one seed learns the
 * rest of the mesh from it.
 */
export const meshRosterView = z.object({
  from: agentInfoSchema,
  /** Bounded: a peer's view is a gossip payload, and gossip is pushed to every agent of the swarm. */
  replicas: z.array(replicaSchema).max(512),
  agents: z.array(agentInfoSchema).max(512),
  /** Replicated settings (`node.doors` first). Newest `updatedAt` per key wins. Defaulted for an older agent's view. */
  settings: z.array(meshSettingSchema).max(256).default([]),
  /**
   * When the sender installed the credential it is on. A receiver whose epoch is behind fetches `roster.credential`
   * from the sender and adopts it, which is how a node that missed a rotation converges inside the grace window.
   */
  credentialEpoch: z.number().int().nonnegative().default(0),
});

export type AgentOverlay = z.infer<typeof agentOverlaySchema>;
export type AgentInfo = z.infer<typeof agentInfoSchema>;
export type MeshRosterView = z.infer<typeof meshRosterView>;

const meshRosterOps = standard.zod(agentInfoSchema, "meshRoster");

export const meshRosterExchangeContract = meshRosterOps
  .create()
  .path("/exchange")
  .input((b) => b.body(meshRosterView))
  .output(meshRosterView)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
