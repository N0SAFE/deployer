import z from "zod/v4";
import { standard } from "@repo/orpc-utils";

// Define the input for the check endpoint
export const healthCheckInput = z.object({});

// Define the output for the check endpoint
export const healthCheckOutput = z.object({
  status: z.string(),
  timestamp: z.date(),
  service: z.string().optional(),
});

const healthCheckOps = standard.zod(healthCheckOutput, "healthCheck");

// Define the contract
export const healthCheckContract = healthCheckOps
  .list()
  .path("/")
  .input(healthCheckInput)
  .output(healthCheckOutput)
  .build();
