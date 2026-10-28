import { runPromiseUnwrapped } from "@deployer/effect-core";
import type { CreateContainerOptions, DockerEngineShape } from "@deployer/docker";
import { Effect } from "effect";

import { AGENT_ROLE, AGENT_ROLE_LABEL, type MeshAgentEngine } from "./agent-container";

/**
 * The mesh agent's container operations over the Effect docker engine. `ensureMeshAgentContainer`
 * still speaks Promises, so this is the Promise face of those engine calls; it holds no logic beyond
 * mapping the engine's inspect result onto what the agent code reads.
 */
export function makeMeshAgentEngine(engine: DockerEngineShape): MeshAgentEngine {
	const { containers, images } = engine;
	return {
		inspect: (name) =>
			runPromiseUnwrapped(
				containers.inspect(name).pipe(
					Effect.map((info) => ({
						id: info.Id,
						running: info.State.Running,
						image: info.Config.Image,
						managed: info.Config.Labels?.[AGENT_ROLE_LABEL] === AGENT_ROLE,
						env: info.Config.Env ?? [],
					})),
					Effect.catchTag("DockerNotFound", () => Effect.succeed(null)),
				),
			),
		create: (name, spec) =>
			runPromiseUnwrapped(containers.create({ name, ...spec } as CreateContainerOptions).pipe(Effect.map(({ id }) => id))),
		start: (id) => runPromiseUnwrapped(containers.start(id)),
		remove: (id) => runPromiseUnwrapped(containers.removeIfExists(id)),
		imageExists: (image) => runPromiseUnwrapped(images.exists(image)),
		pull: (image) => runPromiseUnwrapped(images.pull(image)),
	};
}
