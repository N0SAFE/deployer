import * as z from "zod";
import { standard } from "@repo/orpc-utils";
import { serviceObjectShape } from "@repo/contracts-entities";

export const serviceOps = standard.zod(serviceObjectShape, "service");
export const serviceObjectSchema = serviceObjectShape;
