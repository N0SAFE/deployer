import * as z from "zod";
import { route } from "@repo/orpc-utils/builder";

const streamEventMetaShape = {
    sequence: z.number().int().nonnegative().optional(),
    replayed: z.boolean().optional(),
    emittedAt: z.string().optional(),
} as const;

export const projectStreamEventTypeSchema = z.enum([
    "projectCreated",
    "projectUpdated",
    "projectDeleted",
    "projectCollaboratorInvited",
    "projectCollaboratorRemoved",
    "projectEnvironmentCreated",
    "projectEnvironmentDeleted",
]);

export const projectStreamEventSchema = z.discriminatedUnion("type", [
    z.object({
        type: z.literal("projectCreated"),
        projectId: z.uuid(),
        ownerId: z.string(),
        name: z.string(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("projectUpdated"),
        projectId: z.uuid(),
        ownerId: z.string(),
        changedFields: z.array(z.string()),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("projectDeleted"),
        projectId: z.uuid(),
        ownerId: z.string(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("projectCollaboratorInvited"),
        projectId: z.uuid(),
        userId: z.string(),
        role: z.enum(["owner", "admin", "developer", "viewer"]),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("projectCollaboratorRemoved"),
        projectId: z.uuid(),
        userId: z.string(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("projectEnvironmentCreated"),
        projectId: z.uuid(),
        environmentId: z.uuid(),
        environmentName: z.string(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
    z.object({
        type: z.literal("projectEnvironmentDeleted"),
        projectId: z.uuid(),
        environmentId: z.uuid(),
        timestamp: z.string(),
        ...streamEventMetaShape,
    }),
]);

export type ProjectStreamEvent = z.infer<typeof projectStreamEventSchema>;

export const projectStreamQueryFiltersSchema = z
    .object({
        projectId: z.uuid().optional(),
        ownerId: z.string().optional(),
        eventTypes: z.array(projectStreamEventTypeSchema).optional(),
        fuzzy: z.string().trim().min(1).optional(),
        replay: z.coerce.boolean().default(false),
        replayLimit: z.coerce.number().int().min(1).max(500).default(100),
    })
    .refine((value) => Boolean(value.projectId || value.ownerId || value.fuzzy), {
        message: "At least one stream selector is required (projectId, ownerId, or fuzzy)",
    });

export type ProjectStreamQueryInput = z.infer<typeof projectStreamQueryFiltersSchema>;

export const projectQueryStreamContract = route({
    method: "GET",
    path: "/stream/query",
    summary: "Stream project events with typed filters (SSE)",
    description:
        "Subscribe to project lifecycle/collaboration/environment events with fuzzy search and custom filters.",
})
    .input((b) => b.query(projectStreamQueryFiltersSchema))
    .output((b) => b.streamed(projectStreamEventSchema))
    .build();
