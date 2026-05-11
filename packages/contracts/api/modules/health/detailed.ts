import z from "zod/v4";
import { standard } from "@repo/orpc-utils";

// Define the input for the detailed endpoint
export const healthDetailedInput = z.object({});

// Define the output for the detailed endpoint
export const healthDetailedOutput = z.object({
  status: z.string(),
  timestamp: z.date(),
  service: z.string(),
  uptime: z.coerce.number(),
  memory: z.object({
    used: z.coerce.number(),
    free: z.coerce.number(),
    total: z.coerce.number(),
  }),
  database: z.object({
    status: z.string(),
    timestamp: z.date(),
    responseTime: z.coerce.number().optional(),
    error: z.string().optional(),
  }),
});

const healthDetailedOps = standard.zod(healthDetailedOutput, "healthDetailed");

// Define the contract
export const healthDetailedContract = healthDetailedOps
  .list()
  .path("/detailed")
  .input(healthDetailedInput)
  .output(healthDetailedOutput)
  .build();
