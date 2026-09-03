import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerImageInspectDetailSchema } from "@repo/contracts-entities";
import z from "zod/v4";

export const dockerImageInspectQuerySchema = z.object({
  imageId: z.string().min(1),
});

const dockerImageInspectOps = standard.zod(dockerImageInspectDetailSchema, "dockerImageInspect");

export const dockerImageInspectContract = dockerImageInspectOps
  .list()
  .path("/inspect")
  .input((b) => b.query(dockerImageInspectQuerySchema))
  .output((b) => b.body(dockerImageInspectDetailSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

export type DockerImageInspectQueryInput = z.infer<typeof dockerImageInspectQuerySchema>;
