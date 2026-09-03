import z from "zod/v4";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { environmentKindSchema } from "@repo/contracts-entities";
import { projectEnvironmentOps } from "./shared";

export const projectCloneEnvironmentContract = projectEnvironmentOps
    .create()
    .input((b) =>
        b
            .params(
                (p) =>
                    p`/${p("id", b.entitySchema.shape.projectId)}/environments/${p("environmentId", b.entitySchema.shape.id)}/clone`,
            )
            .body(
                z.object({
                    name: z.string().min(1).max(100),
                    kind: environmentKindSchema.optional(),
                }),
            ),
    )
    .output((b) => b.entitySchema)
    .errors((e) => [
        // 404 for unknown source env; 409 duplicate target name.
        ...standardDomainErrorContracts(e),
    ])
    .build();
