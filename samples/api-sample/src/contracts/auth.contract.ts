import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";
import { commonErrors } from "./errors";

export const authContract = {
  me: oc
    .meta(openapi({ method: "GET", path: "/auth/me", summary: "Current session" }))
    .errors(commonErrors)
    .output(z.object({ id: z.string(), email: z.string(), name: z.string() })),

  /** Public: always answers, but says whether a session was resolved. */
  whoami: oc
    .meta(openapi({ method: "GET", path: "/auth/whoami", summary: "Optional auth" }))
    .output(
      z.object({
        authenticated: z.boolean(),
        email: z.string().nullable(),
      }),
    ),
} as const;
