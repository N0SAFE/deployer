import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { variableTemplateSchema } from "@deployer/contracts-entities";

import { projectVariableTemplateOps } from "./shared";

export const projectListVariableTemplatesContract = projectVariableTemplateOps
    .list()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/variable-templates`))
    .output(z.object({ templates: z.array(variableTemplateSchema) }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "template:read", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();

import { standardDomainErrorContracts } from "@deployer/orpc-utils";