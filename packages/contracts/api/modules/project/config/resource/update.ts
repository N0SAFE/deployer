import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectResourceConfigSchema } from "@repo/contracts-entities";
 
const projectResourceConfigOps = standard.zod(projectResourceConfigSchema, "projectResourceConfig");

const projectResourceConfigUpdateInputSchema = z.object(projectResourceConfigSchema.shape).partial();

export const projectUpdateResourceConfigContract = projectResourceConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/resource`)
            .body(projectResourceConfigUpdateInputSchema),
    )
    .output(projectResourceConfigSchema)
    .build();
