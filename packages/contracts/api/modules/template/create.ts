import { standard } from "@repo/orpc-utils";
import { deploymentTemplateSchema, templateCreateInputSchema } from "@repo/api-contracts/common/template";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateCreateContract = templateOps
    .create()
    .input(templateCreateInputSchema)
    .build();
