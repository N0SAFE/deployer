import z from "zod/v4";
import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";

export const deviceSchema = z.object({
  deviceName: z.string(),
  lastUsed: z.date(),
});

export const getStatsOutputSchema = z.object({
  totalSubscriptions: z.number(),
  activeSubscriptions: z.number(),
  devices: z.array(deviceSchema),
});

const pushStatsOps = standard.zod(getStatsOutputSchema, "pushStats");

export const getStatsContract = pushStatsOps
  .list()
  .path("/stats")
  .input(z.object({}))
  .output(getStatsOutputSchema)
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();
