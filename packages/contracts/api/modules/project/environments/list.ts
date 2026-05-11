import z from "zod/v4";
import { environmentTypeSchema } from "@repo/contracts-entities";
import { projectEnvironmentOps } from "./shared";

export const projectListEnvironmentsContract = projectEnvironmentOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/${p("id", b.entitySchema.shape.projectId)}/environments`)
            .query(z.object({ type: environmentTypeSchema.optional() })),
    )
    .output((b) => z.object({ environments: z.array(b.entitySchema) }))
    .build();
