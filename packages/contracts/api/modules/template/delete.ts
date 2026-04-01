import { standard } from "@repo/orpc-utils";
import { deploymentTemplateSchema } from "@repo/contracts-entities";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateDeleteContract = templateOps.delete().build();
