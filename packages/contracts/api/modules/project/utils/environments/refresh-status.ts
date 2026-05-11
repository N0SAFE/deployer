import z from "zod/v4";
import { environmentStatusSchema } from "@repo/contracts-entities";
import { projectEnvironmentStatusOps } from "../shared";

export const projectRefreshEnvironmentStatusContract = projectEnvironmentStatusOps
    .create()
    .input((b) =>
        b.params((p) => p`/${p("id", z.uuid())}/environments/${p("environmentId", z.uuid())}/status/refresh`),
    )
    .output(
        z.object({
            success: z.boolean(),
            status: environmentStatusSchema,
            lastChecked: z.date(),
        }),
    )
    .build();
