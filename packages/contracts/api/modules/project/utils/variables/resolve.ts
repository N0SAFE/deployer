import z from "zod/v4";
import { projectResolvedVariablesOps, projectScopeSchema, resolvedVariablesOutputSchema } from "../shared";

export const projectResolveVariablesContract = projectResolvedVariablesOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/resolve-variables`)
            .body(
                z.object({
                    template: z.string(),
                    environmentId: z.uuid().optional(),
                    scope: projectScopeSchema.optional(),
                }),
            ),
    )
    .output(resolvedVariablesOutputSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";