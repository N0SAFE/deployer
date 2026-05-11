import * as z from "zod";
import { standard } from "@repo/orpc-utils";
import { serviceSchema } from "@repo/contracts-entities";

export const serviceOps = standard.zod(serviceSchema, "service");
export const serviceObjectSchema = z.object(serviceSchema.shape);
