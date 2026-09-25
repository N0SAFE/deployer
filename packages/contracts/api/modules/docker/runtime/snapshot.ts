import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { dockerRuntimeCatalogSchema } from "@repo/contracts-entities";
import z from "zod/v4";

const dockerRuntimeCatalogOps = standard.zod(dockerRuntimeCatalogSchema, "dockerRuntimeCatalog");

/**
 * Query input for the runtime snapshot.
 *
 * `.list()` produces a GET, and OpenAPI requires a GET input schema to satisfy
 * `object | any | unknown`. An empty schema is not just rejected by the
 * generator — the detailed-input builder omits empty parts, so an empty query
 * collapses the envelope down to the void schema and the fix silently
 * disappears. A non-empty schema keeps the envelope intact, which is why the
 * sibling `docker.runtime.stream` contract (also a GET with a query) works.
 */
export const dockerRuntimeSnapshotQuerySchema = z.object({
    /** Restrict the snapshot to these entity kinds. Omit for all of them. */
    include: z
        .array(z.enum(["containers", "images", "networks", "volumes", "registries", "stacks"]))
        .optional(),
});

export const dockerRuntimeSnapshotContract = dockerRuntimeCatalogOps
  .list()
  .path("/snapshot")
  .input((b) => b.query(dockerRuntimeSnapshotQuerySchema))
  .output((b) => b.body(dockerRuntimeCatalogSchema))
  .errors((e) => [...standardDomainErrorContracts(e)])
  .build();