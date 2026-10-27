import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectSchema, projectWithStatsSchema } from "@deployer/contracts-entities";

const projectOps = standard.zod(projectSchema, "project");

export const projectFindByIdContract = projectOps
    .read()
    .output(() => projectWithStatsSchema.nullable())
    .errors((e) => [
        // 404 when the project doesn't exist (or is inaccessible to the caller).
        ...standardDomainErrorContracts(e),
    ])
    .build();

