import { createFilterConfig, standard, type ComputeInputSchema } from "@repo/orpc-utils";
import {
  dockerContainerEntitySchema,
  dockerContainerLinkPathSchema,
  dockerContainerLogEntrySchema,
  dockerContainerProcessEntrySchema,
  dockerFileEntrySchema,
  dockerTerminalProfileSchema,
} from "@repo/contracts-entities";
import z from "zod/v4";

export const dockerContainerListItemSchema = dockerContainerEntitySchema.omit({ relations: true });
export const dockerContainerOps = standard.zod(dockerContainerListItemSchema, "dockerContainer");

const dockerContainerListBuilder = createFilterConfig(dockerContainerOps)
  .withPagination({ defaultLimit: 50, maxLimit: 500, includeOffset: true } as const)
  .withSorting(["createdAt", "updatedAt", "name", "status"] as const, {
    defaultField: "updatedAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    name: { schema: dockerContainerListItemSchema.shape.name, operators: ["eq", "like", "ilike"] as const },
    status: { schema: dockerContainerListItemSchema.shape.status, operators: ["eq"] as const },
    projectId: { schema: dockerContainerListItemSchema.shape.projectId, operators: ["eq"] as const },
    serviceId: { schema: dockerContainerListItemSchema.shape.serviceId, operators: ["eq"] as const },
    managedBy: { schema: dockerContainerListItemSchema.shape.managedBy, operators: ["eq"] as const },
    managedDeploymentId: {
      schema: dockerContainerListItemSchema.shape.managedDeploymentId,
      operators: ["eq"] as const,
    },
    managedServiceId: {
      schema: dockerContainerListItemSchema.shape.managedServiceId,
      operators: ["eq"] as const,
    },
    managedProjectId: {
      schema: dockerContainerListItemSchema.shape.managedProjectId,
      operators: ["eq"] as const,
    },
  });

export const dockerContainerListConfigSchemas = dockerContainerListBuilder.buildConfig();
export const dockerContainerListInputSchema = dockerContainerListBuilder.buildInputSchema();

export type DockerContainerListInput = ComputeInputSchema<typeof dockerContainerListConfigSchemas>;

export const dockerContainerListMetaSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  hasMore: z.boolean(),
});

const dockerContainerGroupedSingleItemSchema = z.object({
  kind: z.literal("single"),
  hash: z.string().min(1),
  container: dockerContainerListItemSchema,
});

const dockerContainerGroupedReplicaItemSchema = z.object({
  kind: z.literal("replica_group"),
  hash: z.string().min(1),
  containers: z.array(dockerContainerListItemSchema).min(2),
});

export const dockerContainerGroupedListItemSchema = z.discriminatedUnion("kind", [
  dockerContainerGroupedSingleItemSchema,
  dockerContainerGroupedReplicaItemSchema,
]);

const dockerContainerGroupedDiagnosticsSchema = z.object({
  hasSharedDaemonAcrossNodes: z.boolean(),
  sharedDaemonGroups: z.array(z.object({
    daemonId: z.string().min(1),
    nodeIds: z.array(z.string().min(1)).min(2),
  })),
});

export const dockerContainerGroupedListSchema = z.object({
  data: z.array(dockerContainerGroupedListItemSchema),
  meta: dockerContainerListMetaSchema,
  diagnostics: dockerContainerGroupedDiagnosticsSchema,
});

export type DockerContainerGroupedListInput = z.infer<typeof dockerContainerListInputSchema>;
export type DockerContainerGroupedListItem = z.infer<typeof dockerContainerGroupedListItemSchema>;
export type DockerContainerGroupedListResult = z.infer<typeof dockerContainerGroupedListSchema>;

export const dockerContainerInspectQuerySchema = z.object({
  containerId: z.string().min(1),
});

export const dockerContainerInspectStreamQuerySchema = z.object({
  containerId: z.string().min(1),
  refreshIntervalMs: z.coerce.number().int().min(400).max(60_000).optional(),
});

export const dockerContainerLogsStreamQuerySchema = z.object({
  containerId: z.string().min(1),
  tail: z.coerce.number().int().min(1).max(5_000).optional(),
  refreshIntervalMs: z.coerce.number().int().min(400).max(30_000).optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});

export const dockerContainerLogsSnapshotSchema = z.object({
  generatedAt: z.date(),
  entries: z.array(dockerContainerLogEntrySchema),
});

export const dockerContainerProcessesQuerySchema = z.object({
  containerId: z.string().min(1),
});

export const dockerContainerProcessesStreamQuerySchema = z.object({
  containerId: z.string().min(1),
  refreshIntervalMs: z.coerce.number().int().min(400).max(30_000).optional(),
});

export const dockerContainerProcessLogsStreamQuerySchema = z.object({
  containerId: z.string().min(1),
  pid: z.coerce.number().int().nonnegative(),
  tail: z.coerce.number().int().min(1).max(5_000).optional(),
  refreshIntervalMs: z.coerce.number().int().min(400).max(30_000).optional(),
});

export const dockerContainerFilesQuerySchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1).optional(),
});

export const dockerContainerReadFileQuerySchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1),
  maxBytes: z.coerce.number().int().min(1).max(5_000_000).optional(),
});

export const dockerContainerWriteFileBodySchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1),
  content: z.string(),
  createParents: z.boolean().optional(),
});

export const dockerContainerDeletePathBodySchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1),
});

export const dockerContainerRenamePathBodySchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1),
  nextPath: z.string().min(1),
});

export const dockerContainerCreateDirectoryBodySchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1),
});

export const dockerContainerTerminalOpenBodySchema = z.object({
  containerId: z.string().min(1),
  shell: z.enum(["bash", "sh", "zsh", "ash"]).optional(),
  user: z.string().min(1).optional(),
  workingDir: z.string().min(1).optional(),
});

export const dockerContainerTerminalStreamQuerySchema = z.object({
  sessionId: z.string().min(1),
});

export const dockerContainerTerminalInputBodySchema = z.object({
  sessionId: z.string().min(1),
  input: z.string(),
});

export const dockerContainerTerminalCloseBodySchema = z.object({
  sessionId: z.string().min(1),
});

export const dockerContainerLifecycleActionSchema = z.enum([
  "start",
  "stop",
  "restart",
  "pause",
  "unpause",
  "kill",
  "remove",
]);

export const dockerContainerRuntimeActionBodySchema = z.object({
  containerId: z.string().min(1),
  action: dockerContainerLifecycleActionSchema,
});

export const dockerContainerProcessesSnapshotSchema = z.object({
  generatedAt: z.date(),
  data: z.array(dockerContainerProcessEntrySchema),
});

export const dockerContainerFilesListSchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1),
  generatedAt: z.date(),
  entries: z.array(dockerFileEntrySchema),
});

export const dockerContainerReadFileSchema = z.object({
  containerId: z.string().min(1),
  path: z.string().min(1),
  generatedAt: z.date(),
  encoding: z.literal("utf8"),
  content: z.string(),
});

export const dockerContainerTerminalSessionEventSchema = z.object({
  sessionId: z.string().min(1),
  timestamp: z.date(),
  type: z.enum(["output", "status", "error"]),
  data: z.string(),
});

export const dockerContainerTerminalSessionOpenSchema = z.object({
  sessionId: z.string().min(1),
  containerId: z.string().min(1),
  shell: z.enum(["bash", "sh", "zsh", "ash"]),
  user: z.string().min(1),
  workingDir: z.string().min(1),
  profiles: z.array(dockerTerminalProfileSchema),
  openedAt: z.date(),
});

export const dockerContainerTerminalMutationAckSchema = z.object({
  ok: z.literal(true),
  timestamp: z.date(),
});

export const dockerContainerRuntimeActionAckSchema = z.object({
  ok: z.literal(true),
  containerId: z.string().min(1),
  action: dockerContainerLifecycleActionSchema,
  timestamp: z.date(),
});

export const dockerContainerLinkedListQuerySchema = dockerContainerListInputSchema.and(
  z.object({
    include: z
      .string()
      .optional()
      .describe(
        `Comma-separated include paths (${dockerContainerLinkPathSchema.options.join(", ")})`,
      ),
    maxDepth: z.coerce.number().int().min(1).max(3).optional().default(3),
  }),
);

export type DockerContainerInspectQueryInput = z.infer<typeof dockerContainerInspectQuerySchema>;
export type DockerContainerInspectStreamQueryInput = z.infer<typeof dockerContainerInspectStreamQuerySchema>;
export type DockerContainerRuntimeActionBodyInput = z.infer<typeof dockerContainerRuntimeActionBodySchema>;
export type DockerContainerRuntimeActionAck = z.infer<typeof dockerContainerRuntimeActionAckSchema>;
export type DockerContainerLinkedListQueryInput = z.infer<typeof dockerContainerLinkedListQuerySchema>;
export type DockerContainerLogsStreamQueryInput = z.infer<typeof dockerContainerLogsStreamQuerySchema>;
export type DockerContainerLogsSnapshot = z.infer<typeof dockerContainerLogsSnapshotSchema>;
export type DockerContainerProcessesQueryInput = z.infer<typeof dockerContainerProcessesQuerySchema>;
export type DockerContainerProcessesStreamQueryInput = z.infer<typeof dockerContainerProcessesStreamQuerySchema>;
export type DockerContainerProcessLogsStreamQueryInput = z.infer<typeof dockerContainerProcessLogsStreamQuerySchema>;
export type DockerContainerFilesQueryInput = z.infer<typeof dockerContainerFilesQuerySchema>;
export type DockerContainerReadFileQueryInput = z.infer<typeof dockerContainerReadFileQuerySchema>;
export type DockerContainerWriteFileBodyInput = z.infer<typeof dockerContainerWriteFileBodySchema>;
export type DockerContainerDeletePathBodyInput = z.infer<typeof dockerContainerDeletePathBodySchema>;
export type DockerContainerRenamePathBodyInput = z.infer<typeof dockerContainerRenamePathBodySchema>;
export type DockerContainerCreateDirectoryBodyInput = z.infer<typeof dockerContainerCreateDirectoryBodySchema>;
export type DockerContainerTerminalOpenBodyInput = z.infer<typeof dockerContainerTerminalOpenBodySchema>;
export type DockerContainerTerminalStreamQueryInput = z.infer<typeof dockerContainerTerminalStreamQuerySchema>;
export type DockerContainerTerminalInputBodyInput = z.infer<typeof dockerContainerTerminalInputBodySchema>;
export type DockerContainerTerminalCloseBodyInput = z.infer<typeof dockerContainerTerminalCloseBodySchema>;