import { Effect } from "effect";

import { createMeshClient } from "./mesh-client";
import { type PooledLink } from "./pooled-link";
import { agentLink, nodeAgentAdminLink, nodeAgentLink } from "./service-link";

import type { ClientContext, ClientLink } from "@orpc/client";

/**
 * The new agent's node door: what a process on the SAME node asks its own agent about itself.
 *
 * The door is served on the agent's local socket only, so these calls never leave the node. The types mirror the
 * agent's contract; they are structural copies so a caller needs no contracts dependency.
 */

export type NodeDoorStatusPeer = {
  readonly nodeId: string;
  readonly meshAddress: string | null;
  readonly endpoint: string | null;
  /** Null until WireGuard has completed a handshake with this peer, or when the interface is absent. */
  readonly latestHandshakeAt: number | null;
};

export type NodeDoorLoad = {
  readonly eventLoopLagMs: number;
  readonly bytesPerSecond: number;
  readonly openStreams: number;
};

/** What the relay did with calls it could not answer directly, for an operator watching a partition. */
export type NodeDoorRelay = {
  readonly forwarded: number;
  readonly noRoute: number;
  readonly unreachable: number;
};

export type NodeDoorStatus = {
  /** The agent's own identity on the mesh (not the platform node id). */
  readonly agentId: string;
  /** The swarm this node belongs to, or null while it is standalone. */
  readonly swarmId: string | null;
  /**
   * Where this agent says peers reach it (`ws://<host>:<port>/mesh/ws`). Absent on an agent that predates the field,
   * in which case the host it names is unknown — never assume a default address.
   */
  readonly advertiseAddress?: string;
  /** The agent's own load sample: the same numbers its lease policy reads. */
  readonly load: NodeDoorLoad;
  /** Absent on an agent that predates multi-hop relay: the counters were added after the door. */
  readonly relay?: NodeDoorRelay;
  readonly interfaceUp: boolean;
  readonly meshAddress: string | null;
  readonly listenPort: number;
  readonly peers: readonly NodeDoorStatusPeer[];
};

export type NodeDoorSetting = {
  readonly key: string;
  readonly value: string;
  /** The writer's clock, in epoch milliseconds: the newest value per key wins. */
  readonly updatedAt: number;
};

export type NodeDoorAgent = {
  readonly nodeId: string;
  readonly address: string;
  /** Labels the platform set on this node (at least `deployer.node-id` when the API has booted against it). */
  readonly labels: Readonly<Record<string, string>>;
  readonly overlay: {
      readonly wireguardKey: string;
      readonly meshAddress: string;
      readonly endpoint: string;
      readonly listenPort: number;
  } | null;
};

export type NodeDoorView = {
  readonly self: NodeDoorAgent;
  readonly agents: readonly NodeDoorAgent[];
};

/** A one-time token another node redeems to join this swarm; `expiresAt` is epoch milliseconds. */
export type NodeDoorJoinToken = {
  readonly token: string;
  readonly expiresAt: number;
};

/** What a joiner's agent learned from redeeming a token. */
export type NodeDoorJoinResult = {
  readonly learned: boolean;
  readonly agents: readonly NodeDoorAgent[];
};

/** The procedures this uses; the agent serves them on the node door only. */
type NodeDoorApi = {
  readonly node: {
      readonly status: (input: Record<string, never>) => Promise<NodeDoorStatus>;
      readonly settings: (input: Record<string, never>) => Promise<{ readonly settings: readonly NodeDoorSetting[] }>;
      readonly labels: (input: { readonly labels: Readonly<Record<string, string>> }) => Promise<Readonly<Record<string, string>>>;
  };
  readonly roster: {
      readonly view: (input: Record<string, never>) => Promise<NodeDoorView>;
      readonly setting: (input: { readonly key: string; readonly value: string }) => Promise<NodeDoorSetting>;
      readonly token: (input: { readonly ttlMs?: number }) => Promise<NodeDoorJoinToken>;
      readonly join: (input: { readonly token: string }) => Promise<NodeDoorJoinResult>;
      readonly check: (input: { readonly token: string }) => Promise<{ readonly valid: boolean }>;
      readonly block: (input: { readonly nodeId: string }) => Promise<{ readonly blocked: readonly string[] }>;
      readonly unblock: (input: { readonly nodeId: string }) => Promise<{ readonly blocked: readonly string[] }>;
  };
};

/**
 * What the platform core may ask the agent. Every call resolves null — never throws — when the node has no agent, the
 * agent does not answer, or it predates the door: the caller then treats that fact as missing, never as an error.
 */
export type NodeDoorClient = {
  status(): Promise<NodeDoorStatus | null>;
  /** The roster settings this node's agent holds, as it stores them (JSON-encoded strings). */
  settings(): Promise<readonly NodeDoorSetting[] | null>;
  view(): Promise<NodeDoorView | null>;
  /** Publish one setting; the value is JSON-encoded, which is what the agent stores. */
  writeSetting(key: string, value: unknown): Promise<NodeDoorSetting | null>;
  /** Issue a join token; the agent's own default TTL applies when `ttlMs` is omitted. */
  issueJoinToken(ttlMs?: number): Promise<NodeDoorJoinToken | null>;
  /** Redeem a join token: the agent joins the swarm the token names. */
  joinWithToken(token: string): Promise<NodeDoorJoinResult | null>;
  /** Whether a token is this swarm's and still good. */
  checkJoinToken(token: string): Promise<boolean | null>;
  /** Merge labels onto this node's roster entry (the API's `deployer.node-id` is the first). */
  labels(labels: Readonly<Record<string, string>>): Promise<Readonly<Record<string, string>> | null>;
  /** Stop trusting a node: its agents and replicas are dropped and it cannot be learned again until unblocked. */
  blockNode(nodeId: string): Promise<readonly string[] | null>;
  /** Lift a block. */
  unblockNode(nodeId: string): Promise<readonly string[] | null>;
};

export type NodeDoorOptions = {
  /** The new agent's local (service) socket. Defaults to the node's agent (`nodeAgentLink`). */
  readonly socketPath?: string;
  /** The agent's ADMIN socket, for the operator procedures. Defaults to `NODE_AGENT_ADMIN_SOCKET`. */
  readonly adminSocketPath?: string;
  /** Tests inject a link instead of opening a socket. */
  readonly link?: ClientLink<ClientContext>;
  /** Tests inject the admin link too. */
  readonly adminLink?: ClientLink<ClientContext>;
  /** How long to wait for the agent before treating it as absent. */
  readonly timeoutMs?: number;
};

/**
 * Where the deployment mounts the agent's socket (`NODE_AGENT_SOCKET`). One agent, one socket: the node door and the
 * services' relay link read the same variable, so a node cannot point half of itself at a different agent.
 */
export const NODE_DOOR_SOCKET_ENV = "NODE_AGENT_SOCKET";

/** The label the API stamps on its own node's roster entry: the platform node id (`cluster_nodes.node_id`). */
export const NODE_ID_LABEL = "deployer.node-id";

/** A typed client over the new agent's node door. */
export function nodeDoor(options: NodeDoorOptions = {}): NodeDoorClient {
  return {
      status: () => callDoor(options, (client) => client.node.status({})),
      settings: async () => (await callDoor(options, (client) => client.node.settings({})))?.settings ?? null,
      view: () => callDoor(options, (client) => client.roster.view({})),
      writeSetting: (key, value) =>
          callDoor(options, (client) => client.roster.setting({ key, value: JSON.stringify(value) })),
      // Operator procedures: the ADMIN door, never the one every service on the node can open.
      issueJoinToken: (ttlMs) =>
          callDoor(options, (client) => client.roster.token(ttlMs === undefined ? {} : { ttlMs }), "admin"),
      joinWithToken: (token) => callDoor(options, (client) => client.roster.join({ token }), "admin"),
      checkJoinToken: async (token) =>
          (await callDoor(options, (client) => client.roster.check({ token }), "admin"))?.valid ?? null,
      labels: (labels) => callDoor(options, (client) => client.node.labels({ labels })),
      blockNode: async (nodeId) =>
          (await callDoor(options, (client) => client.roster.block({ nodeId }), "admin"))?.blocked ?? null,
      unblockNode: async (nodeId) =>
          (await callDoor(options, (client) => client.roster.unblock({ nodeId }), "admin"))?.blocked ?? null,
  };
}

/** The node door when the deployment says where the agent's socket is; the default path otherwise. */
export function nodeDoorFromEnv(env: { get(key: string): unknown }): NodeDoorClient {
  const socketPath = env.get(NODE_DOOR_SOCKET_ENV);
  return typeof socketPath === "string" && socketPath !== "" ? nodeDoor({ socketPath }) : nodeDoor();
}

const NO_DOOR: NodeDoorClient = {
  status: () => Promise.resolve(null),
  settings: () => Promise.resolve(null),
  view: () => Promise.resolve(null),
  writeSetting: () => Promise.resolve(null),
  issueJoinToken: () => Promise.resolve(null),
  joinWithToken: () => Promise.resolve(null),
  checkJoinToken: () => Promise.resolve(null),
  labels: () => Promise.resolve(null),
  blockNode: () => Promise.resolve(null),
  unblockNode: () => Promise.resolve(null),
};

async function callDoor<A>(
  options: NodeDoorOptions,
  call: (client: ReturnType<typeof createMeshClient<NodeDoorApi>>) => Effect.Effect<A, unknown>,
  door: "service" | "admin" = "service",
): Promise<A | null> {
  const injected = door === "admin" ? (options.adminLink ?? options.link) : options.link;
  const owned = injected === undefined;
  const link =
      injected ??
      (door === "admin"
          ? (options.adminSocketPath === undefined ? nodeAgentAdminLink() : agentLink(options.adminSocketPath))
          : (options.socketPath === undefined ? nodeAgentLink() : agentLink(options.socketPath)));
  if (link === undefined) return null;

  try {
      return await withTimeout(
          Effect.runPromise(call(createMeshClient<NodeDoorApi>(link))),
          options.timeoutMs ?? 1_000,
      );
  } catch {
      return null;
  } finally {
      if (owned) await (link as PooledLink<ClientContext>).closeAll().catch(() => undefined);
  }
}

const withTimeout = async <A>(promise: Promise<A>, timeoutMs: number): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
      return await Promise.race([
          promise,
          new Promise<never>((_resolve, reject) => {
              timer = setTimeout(() => {
                  reject(new Error(`the node's agent did not answer within ${String(timeoutMs)} ms`));
              }, timeoutMs);
          }),
      ]);
  } finally {
      if (timer !== undefined) clearTimeout(timer);
  }
};
