import z from "zod/v4";
import { meshNodeRoleSchema, meshRoutingModeSchema, meshPartitionConsistencyModeSchema, meshNodeLifecycleStateSchema } from "./topology.schema";

/**
 * Bootstrap strategy for how this node was configured.
 */
export const meshBootstrapStrategySchema = z.enum(["local", "remote"]);
export type MeshBootstrapStrategy = z.infer<typeof meshBootstrapStrategySchema>;

/**
 * Full node configuration — mirrors the sqlite node_config table.
 * Excludes sensitive fields (peerServiceToken, meshSharedSecret)
 * unless explicitly requested.
 */
export const meshNodeConfigSchema = z.object({
    /** Unique node identifier (UUID v7) */
    nodeId: z.string().uuid(),
    /** Bootstrap strategy */
    strategy: meshBootstrapStrategySchema,
    /** Snapshot of mesh URLs used during bootstrap */
    meshUrlsSnapshot: z.array(z.string()),
    /** PostgreSQL database URL (stored for reconnection) */
    databaseUrl: z.string().nullable(),
    /** ISO-8601 timestamp of initial configuration */
    configuredAt: z.string().nullable(),
    /** ISO-8601 timestamp of last update */
    updatedAt: z.string(),
    /** When the mesh shared secret was last rotated */
    meshSharedSecretUpdatedAt: z.string().nullable(),
    /** Node metadata — region, zone, roles, version, routing mode, etc. */
    region: z.string().nullable().optional(),
    zone: z.string().nullable().optional(),
    roles: z.array(meshNodeRoleSchema).nullable().optional(),
    version: z.string().nullable().optional(),
    routingMode: meshRoutingModeSchema.nullable().optional(),
    consistencyMode: meshPartitionConsistencyModeSchema.nullable().optional(),
    lifecycleState: meshNodeLifecycleStateSchema.nullable().optional(),
    startedAt: z.string().nullable().optional(),
    lastSeenAt: z.string().nullable().optional(),
});
export type MeshNodeConfig = z.infer<typeof meshNodeConfigSchema>;

/**
 * Input schema for updating node configuration.
 * All fields are optional — only provided fields will be updated.
 */
export const meshNodeConfigUpdateInputSchema = z.object({
    /** Override the node ID */
    nodeId: z.string().uuid().optional(),
    /** Bootstrap strategy */
    strategy: meshBootstrapStrategySchema.optional(),
    /** Replace the mesh URLs snapshot */
    meshUrlsSnapshot: z.array(z.string()).optional(),
    /** Database URL */
    databaseUrl: z.string().nullable().optional(),
    /** Node metadata */
    region: z.string().nullable().optional(),
    zone: z.string().nullable().optional(),
    roles: z.array(meshNodeRoleSchema).nullable().optional(),
    version: z.string().nullable().optional(),
    routingMode: meshRoutingModeSchema.nullable().optional(),
    consistencyMode: meshPartitionConsistencyModeSchema.nullable().optional(),
});
export type MeshNodeConfigUpdateInput = z.infer<typeof meshNodeConfigUpdateInputSchema>;

/**
 * Result of a node config update.
 */
export const meshNodeConfigUpdateResultSchema = z.object({
    success: z.boolean(),
    config: meshNodeConfigSchema,
});
export type MeshNodeConfigUpdateResult = z.infer<typeof meshNodeConfigUpdateResultSchema>;

/**
 * Result of regenerating the mesh shared secret.
 * The new secret is returned once — it will not be visible again.
 */
export const meshNodeConfigRegenerateSecretResultSchema = z.object({
    success: z.boolean(),
    meshSharedSecret: z.string(),
    rotatedAt: z.string(),
});
export type MeshNodeConfigRegenerateSecretResult = z.infer<typeof meshNodeConfigRegenerateSecretResultSchema>;

/**
 * Input for testing a database connection.
 */
export const meshNodeConfigTestDbInputSchema = z.object({
    databaseUrl: z.string().url(),
});
export type MeshNodeConfigTestDbInput = z.infer<typeof meshNodeConfigTestDbInputSchema>;

/**
 * Result of testing a database connection.
 */
export const meshNodeConfigTestDbResultSchema = z.object({
    connected: z.boolean(),
    isNewDatabase: z.boolean().nullable().optional(),
    error: z.string().nullable().optional(),
});
export type MeshNodeConfigTestDbResult = z.infer<typeof meshNodeConfigTestDbResultSchema>;
