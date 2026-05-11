import { standard } from "@repo/orpc-utils";
import { dockerRuntimeCatalogSchema } from "@repo/contracts-entities";

const dockerRuntimeCatalogOps = standard.zod(dockerRuntimeCatalogSchema, "dockerRuntimeCatalog");

export const dockerRuntimeSnapshotContract = dockerRuntimeCatalogOps
  .list()
  .path("/snapshot")
  .output((b) => b.body(dockerRuntimeCatalogSchema))
  .build();