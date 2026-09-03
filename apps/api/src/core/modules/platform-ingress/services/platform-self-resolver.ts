/**
 * platform-self-resolver.ts — resolve THIS API container's canonical name on
 * the platform network (docker embedded DNS target). Shared by the config
 * writers (core traefik module) and the direct-port proxy so the "what am I
 * called on the network" logic lives in ONE place.
 */

import type Docker from "dockerode";
import type { EnvService } from "@/config/env/env.service";

/**
 * Priority:
 *   1. explicit `DEPLOYER_API_TARGET` (compose passes the api alias),
 *   2. the container's CANONICAL NAME (inspect by HOSTNAME=container-id) —
 *      docker embedded DNS resolves by NAME, not by id,
 *   3. HOSTNAME (container id) as a last resort,
 *   4. `host.docker.internal` (bare-metal dev — no container).
 */
export async function resolveSelfContainerName(client: Docker, env: EnvService): Promise<string> {
	const explicit = env.get("DEPLOYER_API_TARGET")?.trim();
	if (explicit !== undefined && explicit !== "") return explicit;

	const selfId = process.env.HOSTNAME;
	if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return "host.docker.internal";
	try {
		const info = await client.getContainer(selfId).inspect();
		const name = ((info as unknown as { Name?: string })?.Name ?? "").replace(/^\//, "");
		if (name !== "") return name;
	} catch {
		/* inspect failed — fall through to the container-id heuristic */
	}
	return selfId;
}