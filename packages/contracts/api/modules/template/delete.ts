import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { deploymentTemplateSchema } from "@repo/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateDeleteContract = templateOps
    .delete()
    .errors((e) => [
        // 404 for unknown template id.
        ...standardDomainErrorContracts(e),
    ])
    .build();
