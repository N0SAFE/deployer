import { standard } from "@repo/orpc-utils";
import { projectSchema } from "@repo/api-contracts/common/project";

const projectOps = standard.zod(projectSchema, "project");

export const projectDeleteContract = projectOps.delete().build();
