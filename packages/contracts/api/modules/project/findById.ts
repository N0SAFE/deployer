import { standard } from "@repo/orpc-utils";
import { projectSchema, projectWithStatsSchema } from "@repo/api-contracts/common/project";

const projectOps = standard.zod(projectSchema, "project");

export const projectFindByIdContract = projectOps
    .read()
    .output((_b) => projectWithStatsSchema.nullable())
    .build();

