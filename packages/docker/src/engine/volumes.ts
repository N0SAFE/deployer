import type Docker from "dockerode";
import {
	dockerodeVolumeListResponseSchema,
	type DockerodeVolumeListResponse,
} from "@deployer/contracts-entities";
import { Effect } from "effect";

import type { DockerError } from "../errors";
import { engineCall } from "./call";

export type VolumesShape = {
	/** Volumes on this engine (`GET /volumes`). */
	readonly list: () => Effect.Effect<DockerodeVolumeListResponse["Volumes"], DockerError>;
};

export function makeVolumes(client: Docker): VolumesShape {
	return {
		list: Effect.fn("DockerVolumes.list")(function* () {
			return yield* engineCall("list engine volumes", async () =>
				dockerodeVolumeListResponseSchema.parse(await client.listVolumes()).Volumes,
			);
		}),
	};
}
