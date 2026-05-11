import z from "zod/v4";
import { updateProjectDomainSchema } from "../schemas";
import { projectDomainOps } from "./shared";

export const updateProjectDomainInput = z.object({
    projectId: z.uuid(),
    domainId: z.uuid(),
    ...updateProjectDomainSchema.shape,
});

export const updateProjectDomainContract = projectDomainOps
    .update({ idFieldName: "domainId", idSchema: z.uuid() })
    .input((b) =>
        b
            .params(
                (p) => p`/${p("projectId", z.uuid())}/domains/${p("domainId", z.uuid())}`,
            )
            .body(z.object(updateProjectDomainSchema.shape)),
    )
    .output((b) => b.entitySchema)
    .build();
