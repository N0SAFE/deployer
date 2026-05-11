import z from "zod/v4";
import { projectEnvironmentOps } from "./shared";

export const projectDeleteEnvironmentContract = projectEnvironmentOps
    .delete({ idFieldName: "environmentId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) =>
                p`/${p("id", b.entitySchema.shape.projectId)}/environments/${p("environmentId", b.entitySchema.shape.id)}`,
        ),
    )
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .build();
