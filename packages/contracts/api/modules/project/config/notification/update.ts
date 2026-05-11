import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { projectNotificationConfigSchema } from "@repo/contracts-entities";
 
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
    .build();
