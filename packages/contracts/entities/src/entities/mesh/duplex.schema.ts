import z from "zod/v4";
import { meshControlEnvelopeAckSchema, meshControlEnvelopeSchema } from "./control.schema";
import {
    meshMembershipReconcileInputSchema,
    meshMembershipReconcileResultSchema,
} from "./routing-resources.schema";
import {
    meshPeerConnectionSchema,
    meshPeerHeartbeatInputSchema,
    meshPeerSessionSchema,
    meshRemoteAuthSessionSchema,
    meshRuntimeEventSchema,
    meshTopologyEventSchema,
    meshNodeStateSchema,
    meshMembershipSnapshotSchema,
} from "./topology.schema";

export const meshDuplexStreamAuthInputSchema = z.object({
    type: z.literal("auth"),
    credential: z.string().min(1),
    endpointUrl: z.string().url(),
    serverUrl: z.string().url().optional(),
    resumeToken: z.string().min(1).optional(),
    remoteAuthSession: meshRemoteAuthSessionSchema.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export type MeshDuplexStreamAuthInput = z.infer<typeof meshDuplexStreamAuthInputSchema>;

export const meshDuplexStreamHeartbeatInputSchema = z
    .object({
        type: z.literal("heartbeat"),
    })
    .merge(meshPeerHeartbeatInputSchema);
export type MeshDuplexStreamHeartbeatInput = z.infer<typeof meshDuplexStreamHeartbeatInputSchema>;

export const meshDuplexStreamControlInputSchema = z.object({
    type: z.literal("control"),
    envelope: meshControlEnvelopeSchema,
});
export type MeshDuplexStreamControlInput = z.infer<typeof meshDuplexStreamControlInputSchema>;

export const meshDuplexStreamReconcileInputSchema = z.object({
    type: z.literal("reconcile"),
    reconcile: meshMembershipReconcileInputSchema,
});
export type MeshDuplexStreamReconcileInput = z.infer<typeof meshDuplexStreamReconcileInputSchema>;

export const meshDuplexStreamSnapshotRequestInputSchema = z.object({
    type: z.literal("snapshot_request"),
});
export type MeshDuplexStreamSnapshotRequestInput = z.infer<typeof meshDuplexStreamSnapshotRequestInputSchema>;

export const meshDuplexStreamPingInputSchema = z.object({
    type: z.literal("ping"),
    nonce: z.string().min(1).optional(),
});
export type MeshDuplexStreamPingInput = z.infer<typeof meshDuplexStreamPingInputSchema>;

export const meshDuplexStreamDisconnectInputSchema = z.object({
    type: z.literal("disconnect"),
    reason: z.string().min(1).optional(),
    allowReconnect: z.boolean().default(true),
});
export type MeshDuplexStreamDisconnectInput = z.infer<typeof meshDuplexStreamDisconnectInputSchema>;

export const meshDuplexStreamInputSchema = z.discriminatedUnion("type", [
    meshDuplexStreamAuthInputSchema,
    meshDuplexStreamHeartbeatInputSchema,
    meshDuplexStreamControlInputSchema,
    meshDuplexStreamReconcileInputSchema,
    meshDuplexStreamSnapshotRequestInputSchema,
    meshDuplexStreamPingInputSchema,
    meshDuplexStreamDisconnectInputSchema,
]);
export type MeshDuplexStreamInput = z.infer<typeof meshDuplexStreamInputSchema>;

export const meshDuplexStreamAuthOkOutputSchema = z.object({
    type: z.literal("auth_ok"),
    session: meshPeerSessionSchema,
    localNode: meshNodeStateSchema,
});
export type MeshDuplexStreamAuthOkOutput = z.infer<typeof meshDuplexStreamAuthOkOutputSchema>;

export const meshDuplexStreamHeartbeatAckOutputSchema = z.object({
    type: z.literal("heartbeat_ack"),
    session: meshPeerSessionSchema,
    connection: meshPeerConnectionSchema,
});
export type MeshDuplexStreamHeartbeatAckOutput = z.infer<typeof meshDuplexStreamHeartbeatAckOutputSchema>;

export const meshDuplexStreamControlAckOutputSchema = meshControlEnvelopeAckSchema.extend({
    type: z.literal("control_ack"),
});
export type MeshDuplexStreamControlAckOutput = z.infer<typeof meshDuplexStreamControlAckOutputSchema>;

export const meshDuplexStreamReconcileResultOutputSchema = z.object({
    type: z.literal("reconcile_result"),
    result: meshMembershipReconcileResultSchema,
});
export type MeshDuplexStreamReconcileResultOutput = z.infer<typeof meshDuplexStreamReconcileResultOutputSchema>;

export const meshDuplexStreamSnapshotOutputSchema = z.object({
    type: z.literal("snapshot"),
    snapshot: meshMembershipSnapshotSchema,
});
export type MeshDuplexStreamSnapshotOutput = z.infer<typeof meshDuplexStreamSnapshotOutputSchema>;

export const meshDuplexStreamRuntimeEventOutputSchema = z.object({
    type: z.literal("runtime_event"),
    event: meshRuntimeEventSchema,
});
export type MeshDuplexStreamRuntimeEventOutput = z.infer<typeof meshDuplexStreamRuntimeEventOutputSchema>;

export const meshDuplexStreamTopologyEventOutputSchema = z.object({
    type: z.literal("topology_event"),
    event: meshTopologyEventSchema,
});
export type MeshDuplexStreamTopologyEventOutput = z.infer<typeof meshDuplexStreamTopologyEventOutputSchema>;

export const meshDuplexStreamPongOutputSchema = z.object({
    type: z.literal("pong"),
    nonce: z.string().min(1).optional(),
    timestamp: z.string(),
});
export type MeshDuplexStreamPongOutput = z.infer<typeof meshDuplexStreamPongOutputSchema>;

export const meshDuplexStreamDisconnectedOutputSchema = z.object({
    type: z.literal("disconnected"),
    session: meshPeerSessionSchema,
});
export type MeshDuplexStreamDisconnectedOutput = z.infer<typeof meshDuplexStreamDisconnectedOutputSchema>;

export const meshDuplexStreamErrorCodeSchema = z.enum([
    "auth_required",
    "unauthorized",
    "invalid_event",
    "invalid_sequence",
    "processing_error",
]);
export type MeshDuplexStreamErrorCode = z.infer<typeof meshDuplexStreamErrorCodeSchema>;

export const meshDuplexStreamErrorOutputSchema = z.object({
    type: z.literal("error"),
    code: meshDuplexStreamErrorCodeSchema,
    message: z.string().min(1),
    retryable: z.boolean().default(false),
});
export type MeshDuplexStreamErrorOutput = z.infer<typeof meshDuplexStreamErrorOutputSchema>;

export const meshDuplexStreamOutputSchema = z.discriminatedUnion("type", [
    meshDuplexStreamAuthOkOutputSchema,
    meshDuplexStreamHeartbeatAckOutputSchema,
    meshDuplexStreamControlAckOutputSchema,
    meshDuplexStreamReconcileResultOutputSchema,
    meshDuplexStreamSnapshotOutputSchema,
    meshDuplexStreamRuntimeEventOutputSchema,
    meshDuplexStreamTopologyEventOutputSchema,
    meshDuplexStreamPongOutputSchema,
    meshDuplexStreamDisconnectedOutputSchema,
    meshDuplexStreamErrorOutputSchema,
]);
export type MeshDuplexStreamOutput = z.infer<typeof meshDuplexStreamOutputSchema>;
