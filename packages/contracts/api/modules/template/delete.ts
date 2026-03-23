import { standard } from "@repo/orpc-utils";
import { deploymentTemplateSchema } from "@repo/api-contracts/common/template";

const templateOps = standard.zod(deploymentTemplateSchema, "deploymentTemplate");

export const templateDeleteContract = templateOps.delete().build();
