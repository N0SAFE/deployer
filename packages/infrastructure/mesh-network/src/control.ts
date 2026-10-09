/**
 * The agent's control API — what a process on the SAME node (the API, setup) may
 * ask its mesh agent, over the unix socket.
 *
 * The socket's filesystem permission is the authority: only a process that mounts
 * the agent's run volume can reach it. Authorising the HUMAN behind an admission
 * (operator login, one-time token) is the caller's job, done before it asks.
 */

import z from "zod/v4";

import { doorLaneSchema } from "./doors";
import { endpointCandidateSchema, memberKindSchema, memberStateSchema, rosterStateSchema, signedAdmissionSchema, signedMemberEntrySchema } from "./schemas";

/** Inside the agent container (and every container that mounts its run volume). */
export const AGENT_SOCKET_DIR = "/run/deployer-mesh";
export const AGENT_SOCKET_PATH = `${AGENT_SOCKET_DIR}/agent.sock`;
/** Gossip listener, bound to the member's MESH address only. */
export const MESH_GOSSIP_PORT = 7300;

/** Control API routes. */
export const AGENT_ROUTES = {
	status: "/v1/status",
	cluster: "/v1/cluster",
	joinRequest: "/v1/join-request",
	admissions: "/v1/admissions",
	join: "/v1/join",
	settings: "/v1/settings",
	labels: "/v1/labels",
	revocations: "/v1/revocations",
	leave: "/v1/leave",
	gossip: "/v1/gossip",
} as const;

/**
 * Label a node member carries with its platform node id (`node_config.nodeId`), so
 * a UI can tell which mesh member is which platform node. Set by the API on the
 * node it runs on (`setLabels`, merged) and in a joiner's signed request.
 */
export const MEMBER_LABEL_NODE_ID = "deployer.node-id";

const linkPathSchema = z.enum(["self", "direct", "trying", "relay", "passive"]);

export const agentMemberViewSchema = z.object({
	memberId: z.string(),
	name: z.string(),
	kind: memberKindSchema,
	address: z.string(),
	state: memberStateSchema,
	endpoints: z.array(endpointCandidateSchema),
	labels: z.record(z.string(), z.string()),
	link: z.object({
		path: linkPathSchema,
		endpoint: z.string().nullable(),
		latestHandshakeAt: z.string().nullable(),
	}),
});
export type AgentMemberView = z.output<typeof agentMemberViewSchema>;

export const agentDoorViewSchema = z.object({
	lane: doorLaneSchema,
	container: z.string(),
	bindAddress: z.string(),
	port: z.number().int(),
	state: z.enum(["running", "absent", "failed"]),
	detail: z.string().nullable(),
});
export type AgentDoorView = z.output<typeof agentDoorViewSchema>;

export const agentStatusSchema = z.object({
	memberId: z.string(),
	signingKey: z.string(),
	wireguardKey: z.string(),
	/** Null until the agent founded or joined a cluster. */
	cluster: z
		.object({
			clusterId: z.string(),
			cidr: z.string(),
			listenPort: z.number().int(),
			address: z.string(),
			interfaceUp: z.boolean(),
		})
		.nullable(),
	members: z.array(agentMemberViewSchema),
	settingKeys: z.array(z.string()),
	doors: z.array(agentDoorViewSchema),
	lastGossipAt: z.string().nullable(),
	lastError: z.string().nullable(),
});
export type AgentStatus = z.output<typeof agentStatusSchema>;

export const createClusterRequestSchema = z.object({
	/** Defaults to the agent's own node name (the host's), which callers in containers cannot see. */
	name: z.string().min(1).max(253).optional(),
	cidr: z.string().optional(),
	labels: z.record(z.string(), z.string()).optional(),
});
export type CreateClusterRequest = z.output<typeof createClusterRequestSchema>;

/** Ask the agent to sign a join request for a target cluster. */
export const joinRequestRequestSchema = z.object({
	clusterId: z.string(),
	cidr: z.string(),
	/** Defaults to the agent's own node name. */
	name: z.string().min(1).max(253).optional(),
	labels: z.record(z.string(), z.string()).optional(),
	addressSalt: z.number().int().min(0).max(1_000).optional(),
});
export type JoinRequestRequest = z.output<typeof joinRequestRequestSchema>;

/** Admit a joiner's signed request. */
export const admitRequestSchema = z.object({ request: signedMemberEntrySchema });
export const admitResponseSchema = z.object({ admission: signedAdmissionSchema, roster: rosterStateSchema });
export type AdmitResponse = z.output<typeof admitResponseSchema>;

/** Adopt the roster an admitter returned. */
export const joinClusterRequestSchema = z.object({ roster: rosterStateSchema });

export const settingWriteSchema = z.object({ key: z.string().min(1).max(128), value: z.json() });
export type SettingWrite = z.output<typeof settingWriteSchema>;
export const settingsReadSchema = z.record(z.string(), z.json());

export const labelsWriteSchema = z.object({ labels: z.record(z.string(), z.string()) });
export const revokeRequestSchema = z.object({ memberId: z.string(), reason: z.string().max(512) });

/** Gossip: push the sender's roster, receive the merged one back. */
export const gossipMessageSchema = z.object({ roster: rosterStateSchema });

/** Error body every non-2xx control response carries. */
export const agentErrorSchema = z.object({ code: z.string(), message: z.string() });
export type AgentError = z.output<typeof agentErrorSchema>;
