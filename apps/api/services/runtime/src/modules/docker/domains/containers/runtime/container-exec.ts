import type { DockerEngineShape } from "@deployer/docker";
import { runPromiseUnwrapped } from "@deployer/effect-core";

/** Runs `command` in the container; a non-zero exit is a failure carrying the output. */
export function execInContainer(engine: DockerEngineShape, containerId: string, command: string[]) {
  return runPromiseUnwrapped(engine.exec.run(containerId, command));
}
