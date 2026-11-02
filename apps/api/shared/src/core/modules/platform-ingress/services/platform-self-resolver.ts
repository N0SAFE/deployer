/**
 * platform-self-resolver.ts — resolve THIS API container's canonical name on
 * the platform network (docker embedded DNS target). Shared by the config
 * writers (core traefik module) and the direct-port proxy so the "what am I
 * called on the network" logic lives in ONE place.
 */

import { Effect } from "effect";

import type { ContainersShape } from "@deployer/docker";

import type { EnvService } from "../../../../config/env/env.module";

/**
 * Priority:
 *   1. explicit `DEPLOYER_API_TARGET` (compose passes the api alias),
 *   2. the container's CANONICAL NAME (inspect by HOSTNAME=container-id) —
 *      docker embedded DNS resolves by NAME, not by id,
 *   3. HOSTNAME (container id) as a last resort,
 *   4. `host.docker.internal` (bare-metal dev — no container).
 */
export const resolveSelfContainerName = (containers: ContainersShape, env: EnvService): Effect.Effect<string> =>
	Effect.gen(function* () {
		const explicit = env.get("DEPLOYER_API_TARGET")?.trim();
		if (explicit !== undefined && explicit !== "") return explicit;

		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return "host.docker.internal";
		// An inspect that fails falls through to the container-id heuristic.
		const name = yield* containers.inspect(selfId).pipe(
			Effect.map((info) => info.Name.replace(/^\//, "")),
			Effect.orElseSucceed(() => ""),
		);
		return name !== "" ? name : selfId;
	});
