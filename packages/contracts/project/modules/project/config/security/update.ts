import z from "zod/v4";

import { projectSecurityConfigSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { projectSecurityConfigReadSchema } from "./get";

const projectSecurityConfigOps = standard.zod(projectSecurityConfigSchema, "projectSecurityConfig");

const projectSecurityConfigUpdateInputSchema = z.object(projectSecurityConfigSchema.shape).partial();

export const projectUpdateSecurityConfigContract = projectSecurityConfigOps
    .update({ idFieldName: "id", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/config/security`)
            .body(projectSecurityConfigUpdateInputSchema),
    )
    // Same masked shape as a read: the write accepts a secret, it never echoes one.
    .output(projectSecurityConfigReadSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
