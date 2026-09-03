import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerImageSecurityScanEventSchema } from "@repo/contracts-entities";
import z from "zod/v4";

export const dockerImageSecurityScanStreamQuerySchema = z.object({
  imageId: z.string().min(1),
  refreshIntervalMs: z.coerce.number().int().min(250).max(10_000).optional(),
  forceScan: z.coerce.boolean().optional(),
  maxCacheAgeMs: z.coerce.number().int().min(0).max(7 * 24 * 60 * 60 * 1_000).optional(),
});

const dockerImageSecurityScanEventOps = standard.zod(
  z.object({
    id: z.string().min(1),
    event: dockerImageSecurityScanEventSchema,
  }),
  "dockerImageSecurityScanEvent",
);

export const dockerImageSecurityScanStreamContract = dockerImageSecurityScanEventOps
  .list()
  .path("/stream")
  .input((b) => b.query(dockerImageSecurityScanStreamQuerySchema))
  .output((b) => b.observable(dockerImageSecurityScanEventSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();

export type DockerImageSecurityScanStreamQueryInput = z.infer<typeof dockerImageSecurityScanStreamQuerySchema>;
