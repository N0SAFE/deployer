import { createHash, randomUUID } from "node:crypto";

import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { Context, Effect } from "effect";

import type { MeshResourceIndexUpsertInput, MeshResourceLocation } from "@deployer/contracts-entities";
import type { NodeDoorClient } from "@deployer/mesh-client";
import { clusterJoinGrants, clusterNodeMetrics, clusterNodes, clusterSigningKeys, resourceOwnershipIndex } from "@deployer/nest-schema/global";
import type { NodeConfigRepositoryShape } from "@deployer/node-state";

import { storage, type DatabasePort, type StorageFailure } from "../../database/storage";
import { ClusterDatabaseUrlMissing, JoinGrantNotCreated } from "../mesh.errors";

type ClusterNodeRow = {
	nodeId: string;
	serverUrl: string;
	status: "active" | "suspect" | "draining" | "revoked";
	healthy: boolean;
	lastSeenAt: string | null;
};

type SigningKeyRow = { keyId: string; algorithm: "HS256"; secretMaterial: string; status: "active" | "previous" };

export type SystemMeshClusterRepositoryShape = {
	readonly loadActiveClusterNodes: () => Effect.Effect<ClusterNodeRow[], StorageFailure>;
	readonly loadSigningKeys: () => Effect.Effect<SigningKeyRow[], StorageFailure>;
	readonly loadAllResourceLocations: () => Effect.Effect<MeshResourceLocation[], StorageFailure>;
	readonly persistResourceIndexUpsert: (input: MeshResourceIndexUpsertInput) => Effect.Effect<void, StorageFailure>;
	readonly persistNodeHeartbeat: (input: {
		nodeId: string;
		serverUrl?: string | null;
		metrics: {
			latencyMs: number;
			jitterMs: number;
			packetLossRatio: number;
			throughputMbps: number;
			reliabilityScore: number;
			weight: number;
			measuredAt: string;
		};
	}) => Effect.Effect<void, StorageFailure>;
	readonly issueJoinGrant: (input: {
		targetNodeId?: string | null;
		issuedByUserId: string;
		ttlSeconds: number;
		metadata?: Record<string, unknown> | null;
	}) => Effect.Effect<{ grantId: string; grantToken: string; expiresAt: string; meshJoinToken: string | null }, StorageFailure | JoinGrantNotCreated>;
	/** The grant is consumed and the joining node enrolled; null when the grant is unknown, expired, used or targets another node. */
	readonly consumeJoinGrant: (input: {
		grantToken: string;
		nodeId: string;
		serverUrl: string;
		displayName?: string;
		capabilities?: Record<string, unknown> | null;
		metadata?: Record<string, unknown> | null;
		/** Role the JOINING node asked for; the mesh decides what it grants. */
		requestedSwarmPolicy?: "auto" | "manager" | "worker";
	}) => Effect.Effect<{ grantId: string; nodeId: string; enrolledAt: string; databaseUrl: string } | null, StorageFailure | ClusterDatabaseUrlMissing>;
	readonly revokeJoinGrant: (input: {
		grantId: string;
		revokedByUserId: string;
		reason?: string | null;
	}) => Effect.Effect<{ grantId: string; revokedAt: string } | null, StorageFailure>;
	readonly rotateSigningKey: (input: {
		keyId: string;
		secretMaterial: string;
		expiresAt?: string | null;
	}) => Effect.Effect<{ activeKeyId: string; rotatedKeyId: string; secretMaterial: string }, StorageFailure>;
	readonly registerOrUpdateNode: (input: {
		nodeId: string;
		serverUrl: string;
		displayName?: string | null;
		capabilities?: Record<string, unknown> | null;
		metadata?: Record<string, unknown> | null;
	}) => Effect.Effect<{ nodeId: string; status: "registered" | "updated"; enrolledAt: string }, StorageFailure>;
};

type Ports = {
	readonly database: Context.Service.Shape<typeof DatabasePort>;
	/** The node's config: the database URL setup's Phase 0 wrote is the ONLY source of truth for the URL at runtime. */
	readonly nodeConfig: NodeConfigRepositoryShape;
	/** This node's agent, the only thing that can mint a token a joining node's `roster.join` accepts; null on a node with none. */
	readonly nodeDoor: Pick<NodeDoorClient, "issueJoinToken"> | null;
};

const hashJoinGrantToken = (token: string): string => {
	const pepper = "mesh-join-grant";
	return createHash("sha256").update(`${pepper}:${token}`).digest("hex");
};

const isMeshResourceKind = (value: string): value is MeshResourceLocation["kind"] =>
	value === "deployment" || value === "stream" || value === "log" || value === "queue" || value === "topic";

const toMeshProtocol = (value: unknown): MeshResourceLocation["protocol"] | null =>
	value === "http" || value === "https" || value === "ws" || value === "wss" || value === "sse" ? value : null;

const toHttpMethod = (value: unknown): MeshResourceLocation["endpointMethod"] =>
	value === "GET" || value === "POST" || value === "PUT" || value === "PATCH" || value === "DELETE" ? value : "GET";

const clamp01 = (value: number): number => (Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value)));

export function makeSystemMeshClusterRepository({ database, nodeConfig, nodeDoor }: Ports): SystemMeshClusterRepositoryShape {
	return {
		loadActiveClusterNodes: () =>
			storage(database, (db) =>
				db
					.select({
						nodeId: clusterNodes.nodeId,
						serverUrl: clusterNodes.serverUrl,
						status: clusterNodes.status,
						healthy: clusterNodes.healthy,
						lastSeenAt: clusterNodes.lastSeenAt,
					})
					.from(clusterNodes),
			).pipe(
				Effect.map((rows) =>
					rows.map((row) => ({
						nodeId: row.nodeId,
						serverUrl: row.serverUrl,
						status: row.status,
						healthy: row.healthy,
						lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
					})),
				),
			),

		loadSigningKeys: () =>
			storage(database, (db) =>
				db
					.select({
						keyId: clusterSigningKeys.kid,
						algorithm: clusterSigningKeys.algorithm,
						secretMaterial: clusterSigningKeys.secretMaterial,
						status: clusterSigningKeys.status,
					})
					.from(clusterSigningKeys)
					.where(and(inArray(clusterSigningKeys.status, ["active", "previous"]), isNull(clusterSigningKeys.revokedAt))),
			).pipe(
				Effect.map((rows) =>
					rows
						.filter((row): row is SigningKeyRow => row.algorithm === "HS256" && (row.status === "active" || row.status === "previous"))
						.map((row) => ({
							keyId: row.keyId,
							algorithm: "HS256" as const,
							secretMaterial: row.secretMaterial,
							status: row.status,
						})),
				),
			),

		loadAllResourceLocations: () =>
			storage(database, (db) => db.select().from(resourceOwnershipIndex)).pipe(
				Effect.map((rows) => {
					const locations: MeshResourceLocation[] = [];
					for (const row of rows) {
						if (!isMeshResourceKind(row.resourceKind)) continue;

						const metadata = row.metadata ?? {};
						const ownerServerUrl = row.ownerServerUrl ?? (typeof metadata.ownerServerUrl === "string" ? metadata.ownerServerUrl : null);
						const endpointPath = typeof metadata.endpointPath === "string" ? metadata.endpointPath : null;
						const protocol = toMeshProtocol(metadata.protocol);

						if (!ownerServerUrl || !endpointPath || !protocol) continue;

						locations.push({
							kind: row.resourceKind,
							key: row.resourceKey,
							ownerNodeId: row.ownerNodeId,
							ownerServerUrl,
							endpointPath,
							endpointMethod: toHttpMethod(metadata.endpointMethod),
							protocol,
							persistentConnectionRequired:
								typeof metadata.persistentConnectionRequired === "boolean" ? metadata.persistentConnectionRequired : false,
							abortEndpointPath: typeof metadata.abortEndpointPath === "string" ? metadata.abortEndpointPath : undefined,
							priority: row.priority,
							version: row.version,
							updatedAt: row.updatedAt.toISOString(),
							metadata,
						});
					}
					return locations;
				}),
			),

		persistResourceIndexUpsert: (input) =>
			Effect.gen(function* () {
				if (input.replaceExistingForSource) {
					yield* storage(database, (db) => db.delete(resourceOwnershipIndex).where(eq(resourceOwnershipIndex.ownerNodeId, input.sourceNodeId)));
				}

				for (const resource of input.resources) {
					yield* storage(database, (db) =>
						db
							.delete(resourceOwnershipIndex)
							.where(
								and(
									eq(resourceOwnershipIndex.resourceKind, resource.kind),
									eq(resourceOwnershipIndex.resourceKey, resource.key),
									eq(resourceOwnershipIndex.ownerNodeId, resource.ownerNodeId),
								),
							),
					);

					yield* storage(database, (db) =>
						db.insert(resourceOwnershipIndex).values({
							resourceKind: resource.kind,
							resourceKey: resource.key,
							ownerNodeId: resource.ownerNodeId,
							ownerServerUrl: resource.ownerServerUrl,
							priority: resource.priority,
							status: "active",
							version: resource.version,
							updatedAt: new Date(resource.updatedAt),
							observedAt: new Date(resource.updatedAt),
							metadata: {
								...(resource.metadata ?? {}),
								ownerServerUrl: resource.ownerServerUrl,
								endpointPath: resource.endpointPath,
								protocol: resource.protocol,
								endpointMethod: resource.endpointMethod,
								persistentConnectionRequired: resource.persistentConnectionRequired,
								abortEndpointPath: resource.abortEndpointPath,
							},
						}),
					);
				}
			}),

		persistNodeHeartbeat: (input) =>
			Effect.gen(function* () {
				const serverUrl = input.serverUrl ?? `https://${input.nodeId}.mesh.internal`;
				yield* storage(database, (db) =>
					db
						.insert(clusterNodes)
						.values({
							nodeId: input.nodeId,
							serverUrl,
							status: "active",
							healthy: true,
							lastSeenAt: new Date(input.metrics.measuredAt),
						})
						.onConflictDoUpdate({
							target: clusterNodes.nodeId,
							set: { serverUrl, status: "active", healthy: true, lastSeenAt: new Date(input.metrics.measuredAt), updatedAt: new Date() },
						}),
				);

				yield* storage(database, (db) =>
					db.insert(clusterNodeMetrics).values({
						nodeId: input.nodeId,
						metrics: {
							cpuUsage: clamp01(input.metrics.packetLossRatio),
							memoryUsage: clamp01(1 - input.metrics.reliabilityScore),
							activeStreams: Math.round(input.metrics.throughputMbps),
							queueDepth: Math.round(input.metrics.latencyMs + input.metrics.jitterMs),
							errorRate: clamp01(input.metrics.packetLossRatio),
						},
						reportedAt: new Date(input.metrics.measuredAt),
					}),
				);
			}),

		issueJoinGrant: (input) =>
			Effect.gen(function* () {
				const grantToken = randomUUID();
				const grantTokenHash = hashJoinGrantToken(grantToken);
				const expiresAt = new Date(Date.now() + input.ttlSeconds * 1_000);

				const [created] = yield* storage(database, (db) =>
					db
						.insert(clusterJoinGrants)
						.values({
							targetNodeId: input.targetNodeId ?? null,
							issuedByUserId: input.issuedByUserId,
							grantTokenHash,
							status: "issued",
							expiresAt,
							metadata: input.metadata ?? null,
						})
						.returning({ id: clusterJoinGrants.id, expiresAt: clusterJoinGrants.expiresAt }),
				);

				if (!created) return yield* new JoinGrantNotCreated({});

				// The grant token above is the PLATFORM's record; only this node's agent can mint the token a joining node's
				// `roster.join` accepts. A node with no agent (no door) yields none.
				const meshJoinToken =
					nodeDoor === null ? null : ((yield* Effect.promise(() => nodeDoor.issueJoinToken(input.ttlSeconds * 1_000)))?.token ?? null);

				return { grantId: created.id, grantToken, expiresAt: created.expiresAt.toISOString(), meshJoinToken };
			}),

		consumeJoinGrant: (input) =>
			Effect.gen(function* () {
				const now = new Date();
				const grantTokenHash = hashJoinGrantToken(input.grantToken);

				const [grant] = yield* storage(database, (db) =>
					db
						.select()
						.from(clusterJoinGrants)
						.where(and(eq(clusterJoinGrants.grantTokenHash, grantTokenHash), eq(clusterJoinGrants.status, "issued"), gt(clusterJoinGrants.expiresAt, now)))
						.limit(1),
				);

				if (!grant) return null;
				if (grant.targetNodeId && grant.targetNodeId !== input.nodeId) return null;

				const consumedAt = new Date();

				const [updatedGrant] = yield* storage(database, (db) =>
					db
						.update(clusterJoinGrants)
						.set({ status: "used", usedAt: consumedAt, updatedAt: consumedAt })
						.where(and(eq(clusterJoinGrants.id, grant.id), eq(clusterJoinGrants.status, "issued")))
						.returning({ id: clusterJoinGrants.id }),
				);

				if (!updatedGrant) return null;

				const metadata = {
					...(grant.metadata ?? {}),
					...(input.metadata ?? {}),
					enrolledVia: "bootstrap_join_grant",
					joinGrantId: updatedGrant.id,
				};

				yield* storage(database, (db) =>
					db
						.insert(clusterNodes)
						.values({
							nodeId: input.nodeId,
							serverUrl: input.serverUrl,
							displayName: input.displayName ?? null,
							capabilities: input.capabilities ?? null,
							status: "active",
							healthy: true,
							metadata,
							enrolledAt: consumedAt,
							lastSeenAt: consumedAt,
						})
						.onConflictDoUpdate({
							target: clusterNodes.nodeId,
							set: {
								serverUrl: input.serverUrl,
								displayName: input.displayName ?? null,
								capabilities: input.capabilities ?? null,
								status: "active",
								healthy: true,
								metadata,
								lastSeenAt: consumedAt,
								updatedAt: consumedAt,
							},
						}),
				);

				// The `databaseUrl` is the shared global Postgres URL the joining node should connect to. In a mesh setup
				// every node points at the same cluster DB, so the same URL is returned from the receiving side. The contract
				// requires `z.url()`, so a missing URL fails loudly.
				const databaseUrl = (yield* nodeConfig.find().pipe(Effect.orElseSucceed(() => null)))?.databaseUrl?.trim() ?? null;
				if (!databaseUrl) return yield* new ClusterDatabaseUrlMissing({});

				return { grantId: updatedGrant.id, nodeId: input.nodeId, enrolledAt: consumedAt.toISOString(), databaseUrl };
			}),

		revokeJoinGrant: (input) =>
			Effect.gen(function* () {
				const [grant] = yield* storage(database, (db) =>
					db.select().from(clusterJoinGrants).where(eq(clusterJoinGrants.id, input.grantId)).limit(1),
				);

				if (grant?.status !== "issued") return null;

				const revokedAt = new Date();
				const [revoked] = yield* storage(database, (db) =>
					db
						.update(clusterJoinGrants)
						.set({
							status: "revoked",
							revokedAt,
							updatedAt: revokedAt,
							metadata: { ...(grant.metadata ?? {}), revokedByUserId: input.revokedByUserId, revokeReason: input.reason ?? null },
						})
						.where(and(eq(clusterJoinGrants.id, grant.id), eq(clusterJoinGrants.status, "issued")))
						.returning({ id: clusterJoinGrants.id }),
				);

				return revoked ? { grantId: revoked.id, revokedAt: revokedAt.toISOString() } : null;
			}),

		rotateSigningKey: (input) =>
			Effect.gen(function* () {
				const now = new Date();

				yield* storage(database, (db) =>
					db.update(clusterSigningKeys).set({ status: "previous", rotatedAt: now, updatedAt: now }).where(eq(clusterSigningKeys.status, "active")),
				);

				yield* storage(database, (db) =>
					db.insert(clusterSigningKeys).values({
						kid: input.keyId,
						algorithm: "HS256",
						status: "active",
						secretMaterial: input.secretMaterial,
						activatedAt: now,
						expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
						updatedAt: now,
					}),
				);

				return { activeKeyId: input.keyId, rotatedKeyId: input.keyId, secretMaterial: input.secretMaterial };
			}),

		registerOrUpdateNode: (input) =>
			Effect.gen(function* () {
				const enrolledAt = new Date();

				const [existing] = yield* storage(database, (db) =>
					db.select({ nodeId: clusterNodes.nodeId }).from(clusterNodes).where(eq(clusterNodes.nodeId, input.nodeId)).limit(1),
				);

				yield* storage(database, (db) =>
					db
						.insert(clusterNodes)
						.values({
							nodeId: input.nodeId,
							serverUrl: input.serverUrl,
							displayName: input.displayName ?? null,
							capabilities: input.capabilities ?? null,
							status: "active",
							healthy: true,
							metadata: input.metadata ?? null,
							enrolledAt,
							lastSeenAt: enrolledAt,
						})
						.onConflictDoUpdate({
							target: clusterNodes.nodeId,
							set: {
								serverUrl: input.serverUrl,
								displayName: input.displayName ?? null,
								capabilities: input.capabilities ?? null,
								status: "active",
								healthy: true,
								metadata: input.metadata ?? null,
								lastSeenAt: enrolledAt,
								updatedAt: enrolledAt,
							},
						}),
				);

				return { nodeId: input.nodeId, status: existing ? ("updated" as const) : ("registered" as const), enrolledAt: enrolledAt.toISOString() };
			}),
	};
}

export class SystemMeshClusterRepository extends Context.Service<SystemMeshClusterRepository, SystemMeshClusterRepositoryShape>()(
	"shared/SystemMeshClusterRepository",
) {}
