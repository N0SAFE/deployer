import z from "zod/v4";
import { environmentStatusOutputSchema, projectEnvironmentStatusOps } from "../shared";

export const projectGetAllEnvironmentStatusesContract = projectEnvironmentStatusOps
    .list()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/environments/statuses`))
    .output(
        z.object({
            statuses: z.array(environmentStatusOutputSchema.extend({ environmentName: z.string() })),
        }),
    )
    .build();
