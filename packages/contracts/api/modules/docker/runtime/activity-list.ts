import { createFilterConfig, standard, type ComputeInputSchema, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerRuntimeActivityEntitySchema, dockerRuntimeEventSourceSchema } from "@repo/contracts-entities";

const dockerRuntimeActivityOps = standard.zod(dockerRuntimeActivityEntitySchema, "dockerRuntimeActivity");

export const dockerRuntimeActivityListConfigSchemas = createFilterConfig(dockerRuntimeActivityOps)
  .withPagination({ defaultLimit: 100, maxLimit: 500, includeOffset: true } as const)
  .withSorting(["occurredAt", "createdAt", "updatedAt", "source", "action", "status", "category"] as const, {
    defaultField: "occurredAt",
    defaultDirection: "desc",
  })
  .withFiltering({
    source: { schema: dockerRuntimeEventSourceSchema, operators: ["eq", "in", "notIn"] as const },
    action: { schema: dockerRuntimeActivityEntitySchema.shape.action, operators: ["eq", "in", "notIn", "like", "ilike"] as const },
    actorId: { schema: dockerRuntimeActivityEntitySchema.shape.actorId, operators: ["eq", "in", "notIn", "like", "ilike"] as const },
    status: { schema: dockerRuntimeActivityEntitySchema.shape.status, operators: ["eq", "in", "notIn"] as const },
    category: { schema: dockerRuntimeActivityEntitySchema.shape.category, operators: ["eq", "in", "notIn"] as const },
    severity: { schema: dockerRuntimeActivityEntitySchema.shape.severity, operators: ["eq", "in", "notIn"] as const },
    stage: { schema: dockerRuntimeActivityEntitySchema.shape.stage, operators: ["eq", "in", "notIn", "like", "ilike"] as const },
    scanner: { schema: dockerRuntimeActivityEntitySchema.shape.scanner, operators: ["eq", "in", "notIn", "like", "ilike"] as const },
    flowId: { schema: dockerRuntimeActivityEntitySchema.shape.flowId, operators: ["eq", "in", "notIn", "like", "ilike"] as const },
    dependsOnFlowId: { schema: dockerRuntimeActivityEntitySchema.shape.dependsOnFlowId, operators: ["eq", "in", "notIn", "like", "ilike"] as const },
    occurredAt: { schema: dockerRuntimeActivityEntitySchema.shape.occurredAt, operators: ["eq", "gt", "gte", "lt", "lte", "between"] as const },
  })
  .buildConfig();

export type DockerRuntimeActivityListInput = ComputeInputSchema<typeof dockerRuntimeActivityListConfigSchemas>;

export const dockerRuntimeActivityListContract = dockerRuntimeActivityOps
  .list(dockerRuntimeActivityListConfigSchemas)
  .path("/")
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
