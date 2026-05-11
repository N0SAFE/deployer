import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectGeneralConfigSchema } from "@repo/contracts-entities";
 
const projectGeneralConfigOps = standard.zod(projectGeneralConfigSchema, "projectGeneralConfig");

const projectGeneralConfigUpdateInputSchema = z.object(projectGeneralConfigSchema.shape).partial();

export const projectUpdateGeneralConfigContract = projectGeneralConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/general`)
            .body(projectGeneralConfigUpdateInputSchema),
    )
    .output(projectGeneralConfigSchema)
    .build();
