import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { deploymentTemplateSchema, templateUpdateInputSchema } from "@repo/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateUpdateContract = templateOps
    .update()
    .input(templateUpdateInputSchema)
    .errors((e) => [
        // 404 for unknown template id.
        ...standardDomainErrorContracts(e),
    ])
    .build();
