import * as z from "zod";
import { serviceSchema } from "@repo/contracts-entities";
import { serviceOps, serviceObjectSchema } from "./shared";

export const serviceUpdateInputSchema = serviceObjectSchema
  .omit({ id: true, projectId: true, createdAt: true, updatedAt: true })
  .partial()
  .extend({ id: serviceSchema.shape.id });

export type ServiceUpdateInput = z.infer<typeof serviceUpdateInputSchema>;

export const serviceUpdateContract = serviceOps
  .update()
  .input(serviceUpdateInputSchema)
  .build();
