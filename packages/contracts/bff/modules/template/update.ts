import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { deploymentTemplateSchema, templateUpdateInputSchema } from "@deployer/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateUpdateContract = templateOps
    .update()
    .input(templateUpdateInputSchema)
    .errors((e) => [
        // 404 for unknown template id.
        ...standardDomainErrorContracts(e),
    ])
    .build();
