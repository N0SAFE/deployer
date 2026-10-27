import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectDeploymentConfigSchema } from "@deployer/contracts-entities";
 
const projectDeploymentConfigOps = standard.zod(projectDeploymentConfigSchema, "projectDeploymentConfig");

const projectDeploymentConfigUpdateInputSchema = z.object(projectDeploymentConfigSchema.shape).partial();

export const projectUpdateDeploymentConfigContract = projectDeploymentConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/deployment`)
            .body(projectDeploymentConfigUpdateInputSchema),
    )
    .output(projectDeploymentConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
