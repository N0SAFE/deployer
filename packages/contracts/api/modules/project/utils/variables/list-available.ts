import z from "zod/v4";
import { availableVariableEntrySchema, projectAvailableVariableOps, projectScopeSchema } from "../shared";

export const projectGetAvailableVariablesContract = projectAvailableVariableOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/available-variables`)
            .query(
                z.object({
                    environmentId: z.uuid().optional(),
                    scope: projectScopeSchema.optional(),
                }),
            ),
    )
    .output(
        z.object({
            variables: z.array(availableVariableEntrySchema),
            scopes: z.array(
                z.object({
                    scope: z.string(),
                    description: z.string(),
                    variables: z.array(z.string()),
                }),
            ),
        }),
    )
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";