import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/**
 * This node's mesh, as its agent sees it: whether the overlay interface is up, and what the kernel knows about the peers.
 *
 * The answer the old control API served on `GET /v1/status`. `interfaceUp` and the handshakes are facts about the
 * kernel, so they are read from it at ask time; the addresses come from the roster, which is why a peer without an
 * overlay is still listed (with nulls) rather than hidden.
 */
export const meshNodeStatusPeerSchema = z.object({
  nodeId: z.string().min(1),
  meshAddress: z.string().nullable(),
  endpoint: z.string().nullable(),
  /** Null until WireGuard has completed a handshake with this peer, or when the interface is absent. */
  latestHandshakeAt: z.number().nullable(),
});

export const meshNodeLoadSchema = z.object({
  /** Mean event-loop delay in the sample window, milliseconds. */
  eventLoopLagMs: z.number(),
  /** Bytes the agent's sockets moved in the last second, both directions. */
  bytesPerSecond: z.number(),
  /** Streams the agent is currently carrying. */
  openStreams: z.number().int(),
});

export const meshNodeRelaySchema = z.object({
  /** Calls handed to another agent because the direct link failed. */
  forwarded: z.number().int().nonnegative(),
  /** Calls with no direct link and no next hop left: the target was unreachable from this agent. */
  noRoute: z.number().int().nonnegative(),
  /** Direct links that failed at the transport, and are remembered as unreachable for a while. */
  unreachable: z.number().int().nonnegative(),
});

export const meshNodeStatusSchema = z.object({
  /** The agent's own identity on the mesh (not the platform node id). */
  agentId: z.string().min(1),
  /** The swarm this node belongs to, or null while it is standalone. */
  swarmId: z.string().nullable(),
  /**
   * Where this agent says peers reach it: its websocket URL, whose host is the one a service on this node advertises
   * so its replicas resolve. Defaulted to `""` so the status of an agent that predates the field still parses; `""`
   * means "not advertised", never a dialable address.
   */
  advertiseAddress: z.string().default(""),
  /** What the agent is carrying right now: the lease policy's own sample. */
  load: meshNodeLoadSchema,
  /**
   * What the relay has done since it started: forwarded calls, routes it could not find, links it found dead. Defaulted
   * so the status of an agent that predates the counters still parses.
   */
  relay: meshNodeRelaySchema.default({ forwarded: 0, noRoute: 0, unreachable: 0 }),
  interfaceUp: z.boolean(),
  meshAddress: z.string().nullable(),
  listenPort: z.number().int(),
  peers: z.array(meshNodeStatusPeerSchema),
});

export type MeshNodeStatus = z.infer<typeof meshNodeStatusSchema>;
export type MeshNodeStatusPeer = z.infer<typeof meshNodeStatusPeerSchema>;
export type MeshNodeRelayCounters = z.infer<typeof meshNodeRelaySchema>;

const meshNodeStatusOps = standard.zod(meshNodeStatusSchema, "meshNodeStatus");

/** This node's mesh state. Read-only. */
export const meshNodeStatusContract = meshNodeStatusOps
  .list()
  .path("/status")
  .input(z.object({}))
  .output(meshNodeStatusSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
