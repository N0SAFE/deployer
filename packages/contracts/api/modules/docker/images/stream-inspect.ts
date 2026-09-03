import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerImageInspectDetailSchema } from "@repo/contracts-entities";
import z from "zod/v4";

export const dockerImageInspectStreamQuerySchema = z.object({
  imageId: z.string().min(1),
  refreshIntervalMs: z.coerce.number().int().min(400).max(60_000).optional(),
});

const dockerImageInspectStreamOps = standard.zod(
  dockerImageInspectDetailSchema,
  "dockerImageInspectStream",
);

export const dockerImageInspectStreamContract = dockerImageInspectStreamOps
  .list()
  .path("/inspect/stream")
  .input((b) => b.query(dockerImageInspectStreamQuerySchema))
  .output((b) => b.observable(dockerImageInspectDetailSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

export type DockerImageInspectStreamQueryInput = z.infer<typeof dockerImageInspectStreamQuerySchema>;
