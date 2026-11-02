import z from "zod/v4";

import { projectNotificationConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
 
const projectNotificationConfigOps = standard.zod(projectNotificationConfigSchema, "projectNotificationConfig");

export const projectGetNotificationConfigContract = projectNotificationConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/notification`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
