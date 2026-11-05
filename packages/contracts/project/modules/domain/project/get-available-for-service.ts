import z from "zod/v4";

import { projectDomainMappingsOps } from "./shared";

export const getAvailableDomainsForServiceInput = z.object({
    projectId: z.uuid(),
    serviceId: z.uuid().optional(),
});

export const getAvailableDomainsForServiceContract = projectDomainMappingsOps
    .list()
    .input((b) =>
        b
            .params((p) => p`/${p("projectId", z.uuid())}/domains/available`)
            .query(
                z.object({
                    serviceId: z.uuid().optional(),
                }),
            ),
    )
    .output((b) => z.array(b.entitySchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "domain:read", scope: { by: "input", path: "params.projectId", kind: "project" } }))
    .build();

import { access } from "@deployer/auth/authz/meta";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";