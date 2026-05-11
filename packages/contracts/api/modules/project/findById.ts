import { standard } from "@repo/orpc-utils";
import { projectSchema, projectWithStatsSchema } from "@repo/contracts-entities";

const projectOps = standard.zod(projectSchema, "project");

export const projectFindByIdContract = projectOps
    .read()
    .output(() => projectWithStatsSchema.nullable())
    .build();

