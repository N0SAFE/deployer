import { standard } from "@repo/orpc-utils";
import { dockerRuntimeActivityEntitySchema } from "@repo/contracts-entities";
import z from "zod/v4";

export const dockerRuntimeActivityDetailQuerySchema = z.object({
  id: z.string().uuid(),
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
  .build();

export type DockerRuntimeActivityDetailQueryInput = z.infer<typeof dockerRuntimeActivityDetailQuerySchema>;
