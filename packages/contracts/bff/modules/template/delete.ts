import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { deploymentTemplateSchema } from "@deployer/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateDeleteContract = templateOps
    .delete()
    .errors((e) => [
        // 404 for unknown template id.
        ...standardDomainErrorContracts(e),
    ])
    .build();
