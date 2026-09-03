import z from "zod/v4";
import { environmentKindSchema } from "@repo/contracts-entities";
import { projectEnvironmentOps } from "./shared";

export const projectListEnvironmentsContract = projectEnvironmentOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/${p("id", b.entitySchema.shape.projectId)}/environments`)
            .query(z.object({ kind: environmentKindSchema.optional() })),
    )
    .output((b) => z.object({ environments: z.array(b.entitySchema) }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";