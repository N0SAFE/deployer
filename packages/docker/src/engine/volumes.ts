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
	/** Creates the named volume unless it exists. A create that loses a race is not an error. */
	readonly ensure: (name: string) => Effect.Effect<void, DockerError>;
	readonly list: () => Effect.Effect<DockerodeVolumeListResponse["Volumes"], DockerError>;
};

export function makeVolumes(client: Docker): VolumesShape {
	return {
		ensure: Effect.fn("DockerVolumes.ensure")(function* (name) {
			const exists = yield* engineCall(`inspect volume ${name}`, () => client.getVolume(name).inspect(), `volume '${name}'`).pipe(
				Effect.as(true),
				Effect.catchTag("DockerNotFound", () => Effect.succeed(false)),
			);
			if (exists) return;
			yield* engineCall(`create volume ${name}`, () => client.createVolume({ Name: name })).pipe(Effect.ignore);
		}),
		list: Effect.fn("DockerVolumes.list")(function* () {
			return yield* engineCall("list engine volumes", async () =>
				dockerodeVolumeListResponseSchema.parse(await client.listVolumes()).Volumes,
			);
		}),
	};
}
