import z from "zod/v4";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { environmentKindSchema, environmentTriggerSchema, environmentRulesSchema } from "@repo/contracts-entities";
import { projectEnvironmentOps } from "./shared";

export const projectUpdateEnvironmentContract = projectEnvironmentOps
    .update({ idFieldName: "environmentId", idSchema: z.uuid() })
    .input((b) =>
        b
            .params(
                (p) =>
                    p`/${p("id", b.entitySchema.shape.projectId)}/environments/${p("environmentId", b.entitySchema.shape.id)}`,
            )
            .body(
                z.object({
                    name: z.string().min(1).max(100).optional(),
                    kind: environmentKindSchema.optional(),
                    rules: environmentRulesSchema.optional(),
                    trigger: environmentTriggerSchema.nullable().optional(),
                    description: z.string().optional(),
                    domainConfig: b.entitySchema.shape.domainConfig.optional(),
                    deploymentConfig: b.entitySchema.shape.deploymentConfig.optional(),
                    metadata: b.entitySchema.shape.metadata.optional(),
                }),
            ),
    )
    .output((b) => b.entitySchema)
    .errors((e) => [
        // 404 for unknown env; 409 duplicate name; 400 invalid rules/trigger.
        ...standardDomainErrorContracts(e),
    ])
    .build();
