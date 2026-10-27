import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectSecurityConfigSchema } from "@deployer/contracts-entities";
 
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
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
