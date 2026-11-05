import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { projectResourceConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
 
const projectResourceConfigOps = standard.zod(projectResourceConfigSchema, "projectResourceConfig");

export const projectGetResourceConfigContract = projectResourceConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/resource`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "project:read", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();
