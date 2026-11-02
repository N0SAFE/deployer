import z from "zod/v4";

import { dockerRuntimeEventSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import { dockerRuntimeEventsStreamQuerySchema } from "./shared";


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