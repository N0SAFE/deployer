import z from "zod/v4";
import { environmentStatusOutputSchema, projectEnvironmentStatusOps } from "../shared";

export const projectGetEnvironmentStatusContract = projectEnvironmentStatusOps
    .read({ idFieldName: "environmentId", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/environments/${p("environmentId", z.uuid())}/status`))
    .output(environmentStatusOutputSchema)
    .build();
