import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectNotificationConfigSchema } from "@deployer/contracts-entities";
 
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
    .build();
