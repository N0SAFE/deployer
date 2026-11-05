import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { projectNotificationConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
 
const projectNotificationConfigOps = standard.zod(projectNotificationConfigSchema, "projectNotificationConfig");

const projectNotificationConfigUpdateInputSchema = z.object(projectNotificationConfigSchema.shape).partial();

export const projectUpdateNotificationConfigContract = projectNotificationConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/notification`)
            .body(projectNotificationConfigUpdateInputSchema),
    )
    .output(projectNotificationConfigSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "project:write", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();
