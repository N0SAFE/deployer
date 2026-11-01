import { Context } from "effect";
import z from "zod/v4";

import { resolveDoorImage } from "../../config/node-agent.env";

import type { NodeDoorsSetting } from "./doors.types";

const port = z.number().int().min(1).max(65_535);
const dns = z.string().min(1).max(253).regex(/^[A-Za-z0-9.-]+$/, "must be a DNS name");

/**
 * The `node.doors` roster setting, validated before anything is planned from it.
 *
 * The API writes it; an agent that reads a malformed one keeps the node exactly as it is and says why, rather than
 * converging a half-valid plan onto the host.
 */
export const nodeDoorsSettingSchema: z.ZodType<NodeDoorsSetting> = z.object({
	image: z.string().min(1).max(256),
	network: dns,
	namePrefix: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
	entryPort: port,
	upstream: dns,
	lanes: z.object({
		local: z.object({ upstreamPort: port }),
		private: z.object({ upstreamPort: port }).nullable(),
		lan: z.object({ upstreamPort: port }).nullable(),
	}),
	rescue: z.array(z.object({ host: dns, target: dns, port })).max(16),
});

export type DoorsSettingParse = {
	readonly setting: NodeDoorsSetting | null;
	/** Why a present setting was rejected; null when there was none or it was valid. */
	readonly error: string | null;
};

export function parseNodeDoorsSetting(raw: string | undefined): DoorsSettingParse {
	if (raw === undefined) return { setting: null, error: null };

	try {
		const parsed = nodeDoorsSettingSchema.safeParse(JSON.parse(raw));
		return parsed.success
			? { setting: parsed.data, error: null }
			: { setting: null, error: parsed.error.message };
	} catch (error: unknown) {
		return { setting: null, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The one image a node door may run. The deployment pins it (`NODE_AGENT_DOOR_IMAGE`); a `node.doors` setting that names
 * another one is refused, so a written setting can never make the node run an image the deployment did not choose.
 */
export class DoorImage extends Context.Service<DoorImage, { readonly image: string }>()("node-agent/DoorImage") {
	static readonly live = class DoorImageImpl {
		image = resolveDoorImage({ NODE_AGENT_DOOR_IMAGE: process.env.NODE_AGENT_DOOR_IMAGE || undefined })
	};
}
