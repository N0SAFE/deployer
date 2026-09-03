import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { deploymentTemplateSchema, templateCreateInputSchema } from "@repo/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateCreateContract = templateOps
    .create()
    .input(templateCreateInputSchema)
    .errors((e) => [
        // 409 duplicate template name; 400 invalid template body.
        ...standardDomainErrorContracts(e),
    ])
    .build();
