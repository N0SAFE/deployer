import z from "zod/v4";

import { projectDomainOps } from "./shared";

export const listProjectDomainsInput = z.object({
    projectId: z.uuid(),
});

export const listProjectDomainsContract = projectDomainOps
    .list()
    .input((b) => b.params((p) => p`/${p("projectId", z.uuid())}/domains`))
    .output((b) => z.array(b.entitySchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "domain:read", scope: { by: "input", path: "params.projectId", kind: "project" } }))
    .build();

import { access } from "@deployer/auth/authz/meta";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";