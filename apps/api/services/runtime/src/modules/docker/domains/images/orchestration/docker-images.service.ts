import { Context, Effect } from "effect";

import { serviceOver, type Over } from "@deployer/effect-core";
import type { DockerImageInspectQueryInput } from "@deployer/runtime-contracts/modules/docker/images/inspect";
import type { DockerImageListInput } from "@deployer/runtime-contracts/modules/docker/images/list";

import type { DockerImagesApplicationService } from "../application/docker-images-application.service";

/**
 * The image catalog, as an Effect service.
 *
 * The application layer is a Promise Nest provider (the auto-scan listener runs it out of request), so it arrives through
 * a port — the same shape `CatalogLocalPort` uses for `DockerRepository`. The point is that a handler now *declares*
 * `DockerImages` in its `R`, so the requirement gate audits the dependency instead of the orchestrator hiding it behind a
 * Promise call.
 *
 * Streams are not here: they stay in `DockerImagesOrchestratorService`, which is the RxJS boundary.
 */
export class DockerImageCatalogPort extends Context.Service<
  DockerImageCatalogPort,
  Pick<DockerImagesApplicationService, "listImages" | "inspectImage">
>()("runtime/DockerImageCatalogPort") {}

export type DockerImagesShape = {
  readonly list: (
    input: DockerImageListInput,
  ) => Effect.Effect<Awaited<ReturnType<DockerImagesApplicationService["listImages"]>>, unknown>;
  readonly inspect: (
    input: DockerImageInspectQueryInput,
  ) => Effect.Effect<Awaited<ReturnType<DockerImagesApplicationService["inspectImage"]>>, unknown>;
};

/** Everything a caller must be able to see for these reads to run. */
export type DockerImagesPorts = DockerImageCatalogPort;

export class DockerImages extends Context.Service<DockerImages, Over<DockerImagesShape, DockerImageCatalogPort>>()(
  "runtime/DockerImages",
) {
  /** Stateless: the port is resolved on every call. */
  static readonly live: Over<DockerImagesShape, DockerImageCatalogPort> = serviceOver(
    DockerImageCatalogPort,
    (catalog): DockerImagesShape => ({
      list: (input) => Effect.tryPromise({ try: () => catalog.listImages(input), catch: (error) => error }),
      inspect: (input) => Effect.tryPromise({ try: () => catalog.inspectImage(input), catch: (error) => error }),
    }),
  );
}
