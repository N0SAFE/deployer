import { standard } from "@deployer/orpc-utils";
import { serviceObjectShape } from "@deployer/contracts-entities";

export const serviceOps = standard.zod(serviceObjectShape, "service");
export const serviceObjectSchema = serviceObjectShape;
