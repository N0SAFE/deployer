import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectSchema } from "@deployer/contracts-entities";

const projectOps = standard.zod(projectSchema, "project");

export const projectDeleteContract = projectOps
    .delete()
    .errors((e) => [
        // 404 when the project id doesn't exist; 409 when non-empty (services exist).
        ...standardDomainErrorContracts(e),
    ])
    .build();
