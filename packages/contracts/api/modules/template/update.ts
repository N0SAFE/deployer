import { standard } from "@repo/orpc-utils";
import { deploymentTemplateSchema, templateUpdateInputSchema } from "@repo/api-contracts/common/template";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateUpdateContract = templateOps
    .update()
    .input(templateUpdateInputSchema)
    .build();
