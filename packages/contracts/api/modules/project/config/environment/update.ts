import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectEnvironmentConfigSchema } from "@repo/contracts-entities";
 
const projectEnvironmentConfigOps = standard.zod(projectEnvironmentConfigSchema, "projectEnvironmentConfig");

const projectEnvironmentConfigUpdateInputSchema = z.object(projectEnvironmentConfigSchema.shape).partial();

export const projectUpdateEnvironmentConfigContract = projectEnvironmentConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/environment`)
            .body(projectEnvironmentConfigUpdateInputSchema),
    )
    .output(projectEnvironmentConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
