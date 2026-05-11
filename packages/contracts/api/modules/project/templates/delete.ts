import z from "zod/v4";
import { projectVariableTemplateOps } from "./shared";

export const projectDeleteVariableTemplateContract = projectVariableTemplateOps
    .delete({ idFieldName: "templateId", idSchema: z.uuid() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/variable-templates/${p("templateId", z.uuid())}`))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .build();
