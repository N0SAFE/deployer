import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { deploymentTemplateSchema, templateCreateInputSchema } from "@deployer/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateCreateContract = templateOps
    .create()
    .input(templateCreateInputSchema)
    .errors((e) => [
        // 409 duplicate template name; 400 invalid template body.
        ...standardDomainErrorContracts(e),
    ])
    .build();
