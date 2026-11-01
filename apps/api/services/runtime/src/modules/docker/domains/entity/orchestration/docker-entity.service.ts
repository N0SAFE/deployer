import { serviceOver, type Over } from "@deployer/effect-core";
import { Context, Effect } from "effect";

import type { DockerEntityStreamChunk } from "@deployer/contracts-entities";
import type {
  DockerEntityInspectInput,
  DockerEntityListInput,
} from "@deployer/runtime-contracts/modules/docker/entity/shared";

import type {
  DockerEntityListResult,
  DockerEntityOrchestratorService,
} from "./docker-entity-orchestrator.service";

type Orchestrator = DockerEntityOrchestratorService;

/**
 * The entity facade a handler may call, as an Effect service.
 *
 * The orchestrator stays a Promise Nest class (its stream and chunks are RxJS/buffers), so it arrives through a port.
 * What changes is visibility: the handler declares `DockerEntity` in its `R`, so the requirement gate audits it instead
 * of the controller calling a Promise collaborator that reaches the app-wide runtime.
 */
export class DockerEntityPort extends Context.Service<
  DockerEntityPort,
  Pick<
    Orchestrator,
    | "listContainers"
    | "listImages"
    | "listNetworks"
    | "listVolumes"
    | "inspectContainer"
    | "inspectImage"
    | "inspectNetwork"
    | "inspectVolume"
  >
>()("runtime/DockerEntityPort") {}

/** Every unary call as an Effect, written out so `procedure(...).effect(...)` can constrain the handler's yields. */
export type DockerEntityShape = {
  readonly listContainers: (
    input: DockerEntityListInput,
  ) => Effect.Effect<DockerEntityListResult<"container">, unknown>;
  readonly listImages: (input: DockerEntityListInput) => Effect.Effect<DockerEntityListResult<"image">, unknown>;
  readonly listNetworks: (input: DockerEntityListInput) => Effect.Effect<DockerEntityListResult<"network">, unknown>;
  readonly listVolumes: (input: DockerEntityListInput) => Effect.Effect<DockerEntityListResult<"volume">, unknown>;
  readonly inspectContainer: (input: DockerEntityInspectInput) => Effect.Effect<DockerEntityStreamChunk | null, unknown>;
  readonly inspectImage: (input: DockerEntityInspectInput) => Effect.Effect<DockerEntityStreamChunk | null, unknown>;
  readonly inspectNetwork: (input: DockerEntityInspectInput) => Effect.Effect<DockerEntityStreamChunk | null, unknown>;
  readonly inspectVolume: (input: DockerEntityInspectInput) => Effect.Effect<DockerEntityStreamChunk | null, unknown>;
};

/** Everything a caller must be able to see for these calls to run. */
export type DockerEntityPorts = DockerEntityPort;

const attempt = <A>(call: () => Promise<A>) => Effect.tryPromise({ try: call, catch: (error) => error });

export class DockerEntity extends Context.Service<DockerEntity, Over<DockerEntityShape, DockerEntityPort>>()(
  "runtime/DockerEntity",
) {
  /** Stateless: the port is resolved on every call. */
  static readonly live: Over<DockerEntityShape, DockerEntityPort> = serviceOver(
    DockerEntityPort,
    (entities): DockerEntityShape => ({
      listContainers: (input) => attempt(() => entities.listContainers(input)),
      listImages: (input) => attempt(() => entities.listImages(input)),
      listNetworks: (input) => attempt(() => entities.listNetworks(input)),
      listVolumes: (input) => attempt(() => entities.listVolumes(input)),
      inspectContainer: (input) => attempt(() => entities.inspectContainer(input)),
      inspectImage: (input) => attempt(() => entities.inspectImage(input)),
      inspectNetwork: (input) => attempt(() => entities.inspectNetwork(input)),
      inspectVolume: (input) => attempt(() => entities.inspectVolume(input)),
    }),
  );
}
