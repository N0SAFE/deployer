import { standard } from "@repo/orpc-utils";
import { deploymentTemplateSchema, templateUpdateInputSchema } from "@repo/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateUpdateContract = templateOps
    .update()
    .input(templateUpdateInputSchema)
    .build();
