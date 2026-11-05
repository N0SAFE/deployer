import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { projectGeneralConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
 
const projectGeneralConfigOps = standard.zod(projectGeneralConfigSchema, "projectGeneralConfig");

export const projectGetGeneralConfigContract = projectGeneralConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/general`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "project:read", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();
