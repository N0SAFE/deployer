import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { projectResourceConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
 
const projectResourceConfigOps = standard.zod(projectResourceConfigSchema, "projectResourceConfig");

const projectResourceConfigUpdateInputSchema = z.object(projectResourceConfigSchema.shape).partial();

export const projectUpdateResourceConfigContract = projectResourceConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/resource`)
            .body(projectResourceConfigUpdateInputSchema),
    )
    .output(projectResourceConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "project:write", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();
