import z from "zod/v4";

export const meshJoinGrantIssueInputSchema = z.object({

    targetNodeId: z.uuid().nullable().optional(),
    ttlSeconds: z.number().int().min(30).max(86_400).default(900),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type MeshJoinGrantIssueInput = z.infer<typeof meshJoinGrantIssueInputSchema>;

export const meshJoinGrantIssueCommandInputSchema = meshJoinGrantIssueInputSchema.extend({
    issuedByUserId: z.string().min(1),
    issuedByRole: z.string().min(1).nullable().optional(),
});
export type MeshJoinGrantIssueCommandInput = z.infer<typeof meshJoinGrantIssueCommandInputSchema>;

export const meshJoinGrantIssueResultSchema = z.object({
    grantId: z.uuid(),
    grantToken: z.string().min(1),
    expiresAt: z.string(),
    status: z.enum(["issued"]),
});
export type MeshJoinGrantIssueResult = z.infer<typeof meshJoinGrantIssueResultSchema>;

export const meshJoinGrantConsumeInputSchema = z.object({
    grantToken: z.string().min(1),
    nodeId: z.uuid(),
    serverUrl: z.string().url(),
    displayName: z.string().min(1).max(255).optional(),
    capabilities: z.record(z.string(), z.unknown()).nullable().optional(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type MeshJoinGrantConsumeInput = z.infer<typeof meshJoinGrantConsumeInputSchema>;

export const meshJoinGrantConsumeResultSchema = z.object({
    accepted: z.boolean(),
    grantId: z.uuid(),
    nodeId: z.uuid(),
    enrolledAt: z.string(),
    databaseUrl: z.url(),
    /**
     * Long-lived signed token the new node presents on subsequent
     * peer-to-peer mesh calls (sent verbatim as `X-Mesh-Internal-Key`).
     *
     * Format: `v2.<issuedAtMs>.<expiresAtMs>.<nodeId>.<hmac>`, signed
     * with a node-specific secret derived from the mesh shared secret
     * and the nodeId. See `@repo/auth/mesh` `signPeerServiceToken` /
     * `verifyPeerServiceToken` for the full envelope.
     *
     * The token is the only thing the local node needs to call
     * authenticated peer-to-peer mesh routes (e.g. `getLocalNode`,
     * `listPeerSessions`) without going through a Better Auth user
     * session. It must be persisted in the caller's `NodeConfigRepository`
     * and re-presented on every subsequent call.
     */
    peerServiceToken: z.string().min(1).nullable(),
    /**
     * ISO timestamp at which `peerServiceToken` stops being accepted.
     * After this point the caller must re-enroll to obtain a new token.
     * Null when no token was issued (mesh shared secret not configured).
     */
    peerServiceTokenExpiresAt: z.string().nullable(),
    /**
     * The mesh shared secret that the joining node should persist in its
     * local node_config table. This secret is used by `requireMesh()` and
     * `requireInternalMesh()` to verify peer credentials — it replaces
     * the static `MESH_STREAM_SHARED_SECRET` env var.
     *
     * The joining node stores this value in `node_config.mesh_shared_secret`
     * and presents it (via `resolveSharedSecret()`) on every subsequent
     * peer-to-peer call that uses mesh authentication.
     *
     * Null when the mesh node has no shared secret configured, meaning
     * peer service tokens cannot be issued.
     */
    meshSharedSecret: z.string().min(1).nullable(),
});
export type MeshJoinGrantConsumeResult = z.infer<typeof meshJoinGrantConsumeResultSchema>;

export const meshRegisterNodeInputSchema = meshJoinGrantConsumeInputSchema.omit({
    grantToken: true,
});
export type MeshRegisterNodeInput = z.infer<typeof meshRegisterNodeInputSchema>;

/**
 * `registerNode` is a re-registration call from an already-enrolled
 * peer. The peer already has a `peerServiceToken` (issued by
 * `consumeJoinGrant`) and already knows the cluster `databaseUrl`, so
 * neither of those belong on the result. The previous version of this
 * schema extended `meshJoinGrantConsumeResultSchema.omit({ grantId: true })`,
 * which silently inherited the token + URL fields and forced the
 * orchestrator to return values it doesn't have.
 */
export const meshRegisterNodeResultSchema = z.object({
    accepted: z.boolean(),
    nodeId: z.uuid(),
    status: z.enum(["registered", "updated"]),
    enrolledAt: z.string(),
});
export type MeshRegisterNodeResult = z.infer<typeof meshRegisterNodeResultSchema>;

export const meshJoinGrantRevokeInputSchema = z.object({
    grantId: z.uuid(),
    reason: z.string().min(1).max(500).nullable().optional(),
});
export type MeshJoinGrantRevokeInput = z.infer<typeof meshJoinGrantRevokeInputSchema>;

export const meshJoinGrantRevokeCommandInputSchema = meshJoinGrantRevokeInputSchema.extend({
    revokedByUserId: z.string().min(1),
    revokedByRole: z.string().min(1).nullable().optional(),
});
export type MeshJoinGrantRevokeCommandInput = z.infer<typeof meshJoinGrantRevokeCommandInputSchema>;

export const meshJoinGrantRevokeResultSchema = z.object({
    revoked: z.boolean(),
    grantId: z.uuid(),
    status: z.enum(["revoked"]),
    revokedAt: z.string(),
});
export type MeshJoinGrantRevokeResult = z.infer<typeof meshJoinGrantRevokeResultSchema>;

export const meshTrustKeySchema = z.object({
    keyId: z.string().min(1),
    algorithm: z.enum(["HS256"]),
    status: z.enum(["active", "previous"]),
});
export type MeshTrustKey = z.infer<typeof meshTrustKeySchema>;

export const meshTrustKeyringStatusResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    keys: z.array(meshTrustKeySchema),
});
export type MeshTrustKeyringStatusResult = z.infer<typeof meshTrustKeyringStatusResultSchema>;

export const meshTrustSecretKeySchema = meshTrustKeySchema.extend({
    secretMaterial: z.string().min(1),
});
export type MeshTrustSecretKey = z.infer<typeof meshTrustSecretKeySchema>;

export const meshTrustKeyringSecretsResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    keys: z.array(meshTrustSecretKeySchema),
});
export type MeshTrustKeyringSecretsResult = z.infer<typeof meshTrustKeyringSecretsResultSchema>;

export const meshTrustKeyringRotateInputSchema = z.object({
    keyId: z.string().min(1).optional(),
    secretMaterial: z.string().min(16).optional(),
    expiresAt: z.string().nullable().optional(),
});
export type MeshTrustKeyringRotateInput = z.infer<typeof meshTrustKeyringRotateInputSchema>;

export const meshTrustKeyringRotateCommandInputSchema = meshTrustKeyringRotateInputSchema.extend({
    rotatedByRole: z.string().min(1).nullable().optional(),
});
export type MeshTrustKeyringRotateCommandInput = z.infer<typeof meshTrustKeyringRotateCommandInputSchema>;

export const meshTrustKeyringRotateResultSchema = z.object({
    activeKeyId: z.string().min(1),
    rotatedKeyId: z.string().min(1),
    secretMaterial: z.string().min(1),
    keys: z.array(meshTrustKeySchema),
});
export type MeshTrustKeyringRotateResult = z.infer<typeof meshTrustKeyringRotateResultSchema>;

export const meshTrustKeyringConvergenceStatusResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    converged: z.boolean(),
    expectedAcks: z.number().int().min(0),
    receivedAcks: z.number().int().min(0),
    pendingNodeIds: z.array(z.uuid()),
    lastRotatedAt: z.string().nullable(),
});
export type MeshTrustKeyringConvergenceStatusResult = z.infer<typeof meshTrustKeyringConvergenceStatusResultSchema>;

export const meshTrustStrictReadinessResultSchema = z.object({
    ready: z.boolean(),
    strictConfigured: z.boolean(),
    strictEnforced: z.boolean(),
    activeKeyId: z.string().min(1).nullable(),
    converged: z.boolean(),
    expectedAcks: z.number().int().min(0),
    receivedAcks: z.number().int().min(0),
    ackRatio: z.number().min(0).max(1),
    minAckRatio: z.number().min(0).max(1),
    maxAckAgeSeconds: z.number().int().min(1),
    lastRotationAgeSeconds: z.number().int().min(0).nullable(),
    rollbackRecommended: z.boolean(),
    rollbackTriggers: z.array(z.string().min(1)),
    reasons: z.array(z.string().min(1)),
});
export type MeshTrustStrictReadinessResult = z.infer<typeof meshTrustStrictReadinessResultSchema>;

export const meshTrustStrictRolloutPlanQuerySchema = z.object({
    waveSize: z.coerce.number().int().min(1).max(100).optional(),
});
export type MeshTrustStrictRolloutPlanQuery = z.infer<typeof meshTrustStrictRolloutPlanQuerySchema>;

export const meshTrustStrictRolloutWaveSchema = z.object({
    index: z.number().int().min(1),
    nodeIds: z.array(z.uuid()),
});
export type MeshTrustStrictRolloutWave = z.infer<typeof meshTrustStrictRolloutWaveSchema>;

export const meshTrustStrictRolloutPlanResultSchema = z.object({
    activeKeyId: z.string().min(1).nullable(),
    strictConfigured: z.boolean(),
    strictEnforced: z.boolean(),
    waveSize: z.number().int().min(1),
    ackedNodeIds: z.array(z.uuid()),
    pendingNodeIds: z.array(z.uuid()),
    waves: z.array(meshTrustStrictRolloutWaveSchema),
    rollbackRecommended: z.boolean(),
    rollbackTriggers: z.array(z.string().min(1)),
});
export type MeshTrustStrictRolloutPlanResult = z.infer<typeof meshTrustStrictRolloutPlanResultSchema>;

export const meshTrustStrictModeSetInputSchema = z.object({
    enabled: z.boolean(),
});
export type MeshTrustStrictModeSetInput = z.infer<typeof meshTrustStrictModeSetInputSchema>;

export const meshTrustStrictModeSetCommandInputSchema = meshTrustStrictModeSetInputSchema.extend({
    setByRole: z.string().min(1).nullable().optional(),
});
export type MeshTrustStrictModeSetCommandInput = z.infer<typeof meshTrustStrictModeSetCommandInputSchema>;

export const meshTrustStrictModeSetResultSchema = meshTrustStrictReadinessResultSchema.extend({
    requested: z.boolean(),
});
export type MeshTrustStrictModeSetResult = z.infer<typeof meshTrustStrictModeSetResultSchema>;

export const meshTrustStrictRollbackInputSchema = z.object({
    force: z.boolean().default(false),
    reason: z.string().min(1).max(500).optional(),
});
export type MeshTrustStrictRollbackInput = z.infer<typeof meshTrustStrictRollbackInputSchema>;

export const meshTrustStrictRollbackCommandInputSchema = meshTrustStrictRollbackInputSchema.extend({
    setByRole: z.string().min(1).nullable().optional(),
});
export type MeshTrustStrictRollbackCommandInput = z.infer<typeof meshTrustStrictRollbackCommandInputSchema>;

export const meshTrustStrictRolloutPlanInputSchema = meshTrustStrictRolloutPlanQuerySchema;
export type MeshTrustStrictRolloutPlanInput = z.infer<typeof meshTrustStrictRolloutPlanInputSchema>;

export const meshTrustStrictRollbackResultSchema = meshTrustStrictReadinessResultSchema.extend({
    requested: z.boolean(),
    rolledBack: z.boolean(),
});
export type MeshTrustStrictRollbackResult = z.infer<typeof meshTrustStrictRollbackResultSchema>;
