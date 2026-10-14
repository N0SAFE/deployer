import z from "zod/v4";
import { meshResourceLocationSchema, type MeshResourceKind } from "@repo/contracts-entities";

// ─── Schemas par kind ─────────────────────────────────────────────────────────

export const meshDeploymentResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("deployment"),
});

export const meshStreamResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("stream"),
});

export const meshLogResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("log"),
});

export const meshQueueResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("queue"),
});

export const meshTopicResourceSchema = meshResourceLocationSchema.extend({
    kind: z.literal("topic"),
});

// ─── Registre WeakMap schema → kind ──────────────────────────────────────────
//
// Permet à select(schema) d'inférer le kind sans paramètre explicite.
// Utilise WeakMap pour ne pas empêcher le GC des schemas.

export const registeredSchemaKinds = new WeakMap<z.ZodType, MeshResourceKind>([
    [meshDeploymentResourceSchema, "deployment"],
    [meshStreamResourceSchema, "stream"],
    [meshLogResourceSchema, "log"],
    [meshQueueResourceSchema, "queue"],
    [meshTopicResourceSchema, "topic"],
]);