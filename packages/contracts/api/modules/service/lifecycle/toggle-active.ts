import * as z from "zod";
import { standard } from "@repo/orpc-utils";
import { serviceSchema } from "@repo/contracts-entities";

const serviceToggleActiveParamsSchema = z.object({
  id: z.uuid(),
});

const serviceToggleActiveBodySchema = z.object({
  isActive: z.boolean(),
});

const serviceToggleActiveOps = standard.zod(serviceSchema, "serviceToggleActive");

export const serviceToggleActiveContract = serviceToggleActiveOps
  .patch({ idFieldName: "id", idSchema: z.uuid() })
  .summary("Toggle service active state")
  .path("/:id/toggle-active")
  .input((input) =>
    input
      .params(serviceToggleActiveParamsSchema)
      .body(serviceToggleActiveBodySchema),
  )
  .output(serviceSchema)
  .build();
