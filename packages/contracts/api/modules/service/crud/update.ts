import * as z from "zod";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { serviceObjectShape } from "@repo/contracts-entities";
import { serviceOps, serviceObjectSchema } from "./shared";

export const serviceUpdateInputSchema = serviceObjectSchema
  .omit({ id: true, projectId: true, createdAt: true, updatedAt: true })
  .partial()
  .extend({ id: serviceObjectShape.shape.id, parentId: z.uuid().nullable().optional() });

export type ServiceUpdateInput = z.infer<typeof serviceUpdateInputSchema>;

export const serviceUpdateContract = serviceOps
  .update()
  .input(serviceUpdateInputSchema)
  .errors((e) => [
    // 404 for unknown service id; 400/409 for invalid or conflicting updates.
    ...standardDomainErrorContracts(e),
  ])
  .build();
