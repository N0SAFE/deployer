import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerRuntimeEventSchema } from "@repo/contracts-entities";
import { dockerRuntimeEventsStreamQuerySchema } from "./shared";
import z from "zod/v4";

const dockerRuntimeEventContractEntitySchema = z.object({
  source: z.string(),
  timestamp: z.date().optional(),
});

const dockerRuntimeEventOps = standard.zod(dockerRuntimeEventContractEntitySchema, "dockerRuntimeEvent");

export const dockerRuntimeEventsStreamContract = dockerRuntimeEventOps
  .list()
  .path("/events/stream")
  .input((b) => b.query(dockerRuntimeEventsStreamQuerySchema))
  .output((b) => b.observable(dockerRuntimeEventSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();