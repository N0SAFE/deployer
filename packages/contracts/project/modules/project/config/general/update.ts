import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { projectGeneralConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
 
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
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "project:write", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();
