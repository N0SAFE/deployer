import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { variableTemplateSchema } from "@repo/contracts-entities";

export const projectIdParamSchema = z.object({ id: z.uuid() });

export const projectTemplateParamsSchema = z.object({
    id: z.uuid(),
    templateId: z.uuid(),
});

export const projectVariableTemplateOps = standard.zod(
    variableTemplateSchema,
    "projectVariableTemplate",
);
