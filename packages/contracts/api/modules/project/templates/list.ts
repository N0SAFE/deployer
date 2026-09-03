import z from "zod/v4";
import { variableTemplateSchema } from "@repo/contracts-entities";
import { projectVariableTemplateOps } from "./shared";

export const projectListVariableTemplatesContract = projectVariableTemplateOps
    .list()
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/variable-templates`))
    .output(z.object({ templates: z.array(variableTemplateSchema) }))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";