import z from "zod/v4";

import { dockerRuntimeActivityEntitySchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

export const dockerRuntimeActivityDetailQuerySchema = z.object({
  id: z.uuid(),
});

const dockerRuntimeActivityDetailOps = standard.zod(
  dockerRuntimeActivityEntitySchema,
  "dockerRuntimeActivityDetail",
);

export const dockerRuntimeActivityDetailContract = dockerRuntimeActivityDetailOps
  .list()
  .path("/detail")
  .input((b) => b.query(dockerRuntimeActivityDetailQuerySchema))
  .output((b) => b.body(dockerRuntimeActivityEntitySchema.nullable()))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

export type DockerRuntimeActivityDetailQueryInput = z.infer<typeof dockerRuntimeActivityDetailQuerySchema>;
