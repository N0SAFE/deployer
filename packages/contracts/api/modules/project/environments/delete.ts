import z from "zod/v4";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectEnvironmentOps } from "./shared";

export const projectDeleteEnvironmentContract = projectEnvironmentOps
    .delete({ idFieldName: "environmentId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) =>
                p`/${p("id", b.entitySchema.shape.projectId)}/environments/${p("environmentId", b.entitySchema.shape.id)}`,
        ),
    )
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .errors((e) => [
        // 404 for unknown env; 409 when the env still has service links.
        ...standardDomainErrorContracts(e),
    ])
    .build();
