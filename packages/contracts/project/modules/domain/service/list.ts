import z from "zod/v4";

import { serviceDomainOps } from "./shared";

export const listServiceDomainsInput = z.object({
    serviceId: z.uuid(),
});

export const listServiceDomainsContract = serviceDomainOps
    .list()
    .input((b) => b.params((p) => p`/${p("serviceId", z.uuid())}/domains`))
    .output((b) => z.array(b.entitySchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "domain:read", scope: { by: "input", path: "params.serviceId", kind: "service" } }))
    .build();

import { access } from "@deployer/auth/authz/meta";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";