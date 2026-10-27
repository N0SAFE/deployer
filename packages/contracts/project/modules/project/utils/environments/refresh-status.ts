import z from "zod/v4";
import { environmentStatusSchema } from "@deployer/contracts-entities";
import { projectEnvironmentStatusOps } from "../shared";

export const projectRefreshEnvironmentStatusContract = projectEnvironmentStatusOps
    .read({ idFieldName: "environmentId", idSchema: z.uuid() })
    .input((b) =>
        b.params((p) => p`/${p("id", z.uuid())}/environments/${p("environmentId", z.uuid())}/status/refresh`),
    )
    .output(
        z.object({
            success: z.boolean(),
            status: environmentStatusSchema,
            lastChecked: z.string(),
        }),
    )
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@deployer/orpc-utils";