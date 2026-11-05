import z from "zod/v4";

import { projectCollaboratorOps } from "./shared";

export const projectGetCollaboratorsContract = projectCollaboratorOps
    .list()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/collaborators`))
    .output((b) => z.object({ collaborators: z.array(b.entitySchema) }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "member:read", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();

import { access } from "@deployer/auth/authz/meta";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";