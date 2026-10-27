import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import { z } from "zod";
import { observable } from "./observable";

export const logEventSchema = z.object({
  seq: z.number(),
  at: z.string(),
  message: z.string(),
});

export type LogEvent = z.infer<typeof logEventSchema>;

export const logsContract = {
  /** Output is an RxJS Observable; the transport streams it as SSE. */
  stream: oc
    .meta(openapi({ method: "GET", path: "/logs/stream", summary: "Server-sent events" }))
    .input(z.object({ count: z.coerce.number().int().min(1).max(10).default(3) }))
    .output(observable(logEventSchema)),
} as const;
