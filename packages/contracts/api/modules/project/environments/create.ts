import z from "zod/v4";
import { environmentTypeSchema } from "@repo/contracts-entities";
import { projectEnvironmentOps } from "./shared";

export const projectCreateEnvironmentContract = projectEnvironmentOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", b.entitySchema.shape.projectId)}/environments`)
            .body(
                z.object({
                    name: z.string().min(1).max(100),
                    type: environmentTypeSchema,
                    description: z.string().optional(),
                    domainConfig: b.entitySchema.shape.domainConfig.optional(),
                    deploymentConfig: b.entitySchema.shape.deploymentConfig.optional(),
                    metadata: b.entitySchema.shape.metadata.optional(),
                }),
            ),
    )
    .output((b) => b.entitySchema)
    .build();
