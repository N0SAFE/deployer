import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";
import { commonErrors } from "./errors";

export const planetSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  discoveredAt: z.string(),
});

export type Planet = z.infer<typeof planetSchema>;

export const planetContract = {
  list: oc
    .meta(openapi({ method: "GET", path: "/planets", summary: "List planets" }))
    .input(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(20),
        search: z.string().optional(),
      }),
    )
    .output(z.array(planetSchema)),

  findById: oc
    .meta(openapi({ method: "GET", path: "/planets/{id}", summary: "Find a planet" }))
    .input(z.object({ id: z.string() }))
    .errors({
      NOT_FOUND: { message: "Planet not found", data: z.object({ id: z.string() }) },
    })
    .output(planetSchema),

  create: oc
    .meta(
      openapi({
        method: "POST",
        path: "/planets",
        successStatus: 201,
        summary: "Create a planet (auth required)",
      }),
    )
    .input(z.object({ name: z.string().min(1), description: z.string().optional() }))
    .errors({
      CONFLICT: { message: "Planet already exists", data: z.object({ name: z.string() }) },
    })
    .errors(commonErrors)
    .output(planetSchema),
} as const;
