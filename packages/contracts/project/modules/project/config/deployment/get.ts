import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { projectDeploymentConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
 
const projectDeploymentConfigOps = standard.zod(projectDeploymentConfigSchema, "projectDeploymentConfig");

export const projectGetDeploymentConfigContract = projectDeploymentConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/deployment`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "project:read", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();
