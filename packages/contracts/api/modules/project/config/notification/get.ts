import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectNotificationConfigSchema } from "@repo/contracts-entities";
 
const projectNotificationConfigOps = standard.zod(projectNotificationConfigSchema, "projectNotificationConfig");

export const projectGetNotificationConfigContract = projectNotificationConfigOps
    .read({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/config/notification`))
    .build();
