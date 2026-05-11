import z from "zod/v4";
import { projectDomainOps } from "./shared";

export const removeProjectDomainInput = z.object({
    projectId: z.uuid(),
    domainId: z.uuid(),
});

export const removeProjectDomainOutput = z.object({
    success: z.boolean(),
    message: z.string(),
    affectedServices: z.number(),
});

export const removeProjectDomainContract = projectDomainOps
    .delete({ idFieldName: "domainId", idSchema: z.uuid() })
    .input((b) =>
        b.params(
            (p) => p`/${p("projectId", z.uuid())}/domains/${p("domainId", z.uuid())}`,
        ),
    )
    .output(removeProjectDomainOutput)
    .build();
