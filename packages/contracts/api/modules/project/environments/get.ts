import z from "zod/v4";
import { projectEnvironmentOps } from "./shared";

export const projectGetEnvironmentContract = projectEnvironmentOps
    .read({ idFieldName: "environmentId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) =>
                p`/${p("id", b.entitySchema.shape.projectId)}/environments/${p("environmentId", b.entitySchema.shape.id)}`,
        ),
    )
    .output((b) => b.entitySchema)
    .build();
