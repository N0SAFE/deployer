import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectDeploymentConfigSchema } from "@repo/contracts-entities";
 
const projectDeploymentConfigOps = standard.zod(projectDeploymentConfigSchema, "projectDeploymentConfig");

export const projectGetDeploymentConfigContract = projectDeploymentConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/deployment`))
    .build();
