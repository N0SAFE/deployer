import { eventIterator, oc } from "@orpc/contract";
import { observable } from "@repo/orpc-utils";
import z from "zod/v4";

export const logEventSchema = z.object({
  index: z.number().int().nonnegative(),
  level: z.enum(["info", "warn", "error"]),
  message: z.string(),
  emittedAt: z.string(),
});

export const logStreamInputSchema = z.object({
  count: z.number().int().min(1).max(200).default(30),
  intervalMs: z.number().int().min(80).max(2000).default(250),
});

export const streamLogsObservableContract = oc
  .route({
    method: "GET",
    path: "/stream-logs-observable",
    summary: "Observable-first log stream",
    description: "Streams mock backend logs as an observable contract over SSE transport.",
  })
  .input(logStreamInputSchema)
  .output(observable(logEventSchema));
  
export const streamLogsContract = oc
  .route({
    method: "GET",
    path: "/stream-logs",
    summary: "Log stream",
    description: "Streams mock backend logs as a regular API endpoint.",
  })
  .input(logStreamInputSchema)
  .output(eventIterator(logEventSchema));


export const appContract = oc.router({
  streamObservableLogs: streamLogsObservableContract,
  streamLogs: streamLogsContract,
});

export type AppContract = typeof appContract;
export type LogEvent = z.infer<typeof logEventSchema>;
