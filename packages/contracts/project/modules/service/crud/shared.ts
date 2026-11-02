import { serviceObjectShape } from "@deployer/contracts-entities";
import { standard } from "@deployer/orpc-utils";

export const serviceOps = standard.zod(serviceObjectShape, "service");
export const serviceObjectSchema = serviceObjectShape;
