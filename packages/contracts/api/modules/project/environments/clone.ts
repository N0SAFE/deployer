import z from "zod/v4";
import { environmentTypeSchema } from "@repo/contracts-entities";
import { projectEnvironmentOps } from "./shared";

export const projectCloneEnvironmentContract = projectEnvironmentOps
    .create()
    .input((b) =>
        b
            .params(
                (p) =>
                    p`/${p("id", b.entitySchema.shape.projectId)}/environments/${p("environmentId", b.entitySchema.shape.id)}/clone`,
            )
            .body(
                z.object({
                    name: z.string().min(1).max(100),
                    type: environmentTypeSchema.optional(),
                }),
            ),
    )
    .output((b) => b.entitySchema)
    .build();
