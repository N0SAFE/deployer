import { standard } from "@repo/orpc-utils";
import { projectSchema } from "@repo/contracts-entities";

const projectOps = standard.zod(projectSchema, "project");

export const projectDeleteContract = projectOps.delete().build();
