import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectDeploymentConfigSchema } from "@repo/contracts-entities";
 
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
    .build();
