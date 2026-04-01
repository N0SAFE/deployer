import z from "zod/v4";
import { route } from "@repo/orpc-utils";
import { templateVariableSchema, variableTemplateSchema } from "@repo/contracts-entities";

const idParam = z.object({ id: z.uuid() });
const templateParams = z.object({ id: z.uuid(), templateId: z.uuid() });

export const projectListVariableTemplatesContract = route()
    .method("GET")
    .path("/:id/variable-templates")
    .input(idParam)
    .output(z.object({ templates: z.array(variableTemplateSchema) }))
    .build();

export const projectGetVariableTemplateContract = route()
    .method("GET")
    .path("/:id/variable-templates/:templateId")
    .input(templateParams)
    .output(variableTemplateSchema)
    .build();

export const projectCreateVariableTemplateContract = route()
    .method("POST")
    .path("/:id/variable-templates")
    .input(
        idParam.extend({
            name: z.string().min(1).max(100),
            description: z.string().optional(),
            variables: z.array(templateVariableSchema).default([]),
        }),
    )
    .output(variableTemplateSchema)
    .build();

export const projectUpdateVariableTemplateContract = route()
    .method("PUT")
    .path("/:id/variable-templates/:templateId")
    .input(
        templateParams.extend({
            name: z.string().min(1).max(100).optional(),
            description: z.string().optional(),
            variables: z.array(templateVariableSchema).optional(),
        }),
    )
    .output(variableTemplateSchema)
    .build();

export const projectDeleteVariableTemplateContract = route()
    .method("DELETE")
    .path("/:id/variable-templates/:templateId")
    .input(templateParams)
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .build();
