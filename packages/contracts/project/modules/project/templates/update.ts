import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { templateVariableSchema, variableTemplateSchema } from "@deployer/contracts-entities";

import { projectVariableTemplateOps } from "./shared";

export const projectUpdateVariableTemplateContract = projectVariableTemplateOps
    .update({ idFieldName: "templateId", idSchema: z.uuid() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/variable-templates/${p("templateId", z.uuid())}`)
            .body(
                z.object({
                    name: z.string().min(1).max(100).optional(),
                    description: z.string().optional(),
                    variables: z.array(templateVariableSchema).optional(),
                }),
            ),
    )
    .output(variableTemplateSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .meta(access({ permission: "template:write", scope: { by: "input", path: "params.id", kind: "project" } }))
    .build();

import { standardDomainErrorContracts } from "@deployer/orpc-utils";