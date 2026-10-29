import { dockerodeContainerListSchema, type DockerodeContainerList } from "@deployer/contracts-entities";
import { DockerEngine, type DockerError } from "@deployer/docker";
import { Context, Effect } from "effect";

/**
 * The engine's container list as the runtime reads it: items that do not fit the schema are dropped one by one
 * instead of failing the whole list. Pure, so it is tested with plain objects.
 */
export function parseDockerodeContainers(raw: readonly unknown[]): DockerodeContainerList[] {
  const whole = dockerodeContainerListSchema.array().safeParse(raw);
  if (whole.success) {
    return whole.data;
  }
  return raw
    .filter((item) => dockerodeContainerListSchema.safeParse(item).success)
    .map((item) => dockerodeContainerListSchema.parse(item));
}

export type DockerContainersRepositoryShape = {
  /** Every container the engine reports (running or not), in the shape the runtime reads. */
  readonly listRaw: Effect.Effect<DockerodeContainerList[], DockerError, DockerEngine>;
};

/** The containers of the local engine; a constant that yields the engine when `listRaw` runs. */
export class DockerContainersRepository extends Context.Service<DockerContainersRepository, DockerContainersRepositoryShape>()(
  "runtime/DockerContainersRepository",
) {
  static readonly live: DockerContainersRepositoryShape = {
    listRaw: Effect.gen(function* () {
      const engine = yield* DockerEngine;
      const raw = yield* engine.containers.list({ all: true });
      return parseDockerodeContainers(raw);
    }),
  };
}
