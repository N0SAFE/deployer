import z from "zod/v4";
import { projectVariableTemplateOps } from "./shared";

export const projectGetVariableTemplateContract = projectVariableTemplateOps
    .read({ idFieldName: "templateId", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/variable-templates/${p("templateId", z.uuid())}`))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();

import { standardDomainErrorContracts } from "@repo/orpc-utils";