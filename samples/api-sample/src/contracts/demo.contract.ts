import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";
import { commonErrors } from "./errors";

export const demoContract = {
  /**
   * Calls the same server through an OpenAPI link wrapped as Effect client,
   * proving both the link and the Effect client call path.
   */
  report: oc
    .meta(
      openapi({
        method: "GET",
        path: "/demo/report",
        summary: "Effect client loopback (auth required)",
      }),
    )
    .errors(commonErrors)
    .input(z.object({ missingId: z.string().default("missing") }))
    .output(
      z.object({
        total: z.number(),
        recovered: z.string(),
        traceId: z.string().nullable(),
      }),
    ),
} as const;
