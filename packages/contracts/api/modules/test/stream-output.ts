import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

const testStreamOutputOps = standard.zod(
  z.object({ index: z.number(), message: z.string(), timestamp: z.number() }),
  "testStreamOutput",
);

/**
 * Test contract with eventIterator as OUTPUT (Server-Sent Events)
 * This contract demonstrates streaming data from server to client
 * This is the most common streaming pattern in oRPC
 */
export const testStreamOutputContract = testStreamOutputOps
  .list()
  .path("/stream-output")
  .input((b) =>
    b.query(
      z.object({
        count: z.number().default(10),
        interval: z.number().default(1000),
        message: z.string().default("Hello"),
      }),
    ),
  )
  .output((b) =>
    b.observable(
      z.object({
        index: z.number(),
        message: z.string(),
        timestamp: z.number(),
      }),
    ),
  )
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

// Define types based on schemas
export type TestStreamOutputInput = {
  count?: number;
  interval?: number;
  message?: string;
};

export type TestStreamOutputOutput = AsyncIterableIterator<{
  index: number;
  message: string;
  timestamp: number;
}>;
