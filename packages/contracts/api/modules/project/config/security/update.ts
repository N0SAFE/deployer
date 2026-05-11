import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectSecurityConfigSchema } from "@repo/contracts-entities";
 
const projectSecurityConfigOps = standard.zod(projectSecurityConfigSchema, "projectSecurityConfig");

const projectSecurityConfigUpdateInputSchema = z.object(projectSecurityConfigSchema.shape).partial();

export const projectUpdateSecurityConfigContract = projectSecurityConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/security`)
            .body(projectSecurityConfigUpdateInputSchema),
    )
    .output(projectSecurityConfigSchema)
    .build();
