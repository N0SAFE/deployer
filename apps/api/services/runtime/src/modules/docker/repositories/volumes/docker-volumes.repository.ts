import { dockerVolumeSchema, type DockerVolume } from "@deployer/contracts-entities";
import type { DockerError, DockerEngineShape } from "@deployer/docker";
import { DockerEngine } from "@deployer/docker";
import { Context, Effect } from "effect";

const VOLUME_DRIVERS = ["local", "nfs", "csi", "tmpfs"];

export type DockerVolumesRepositoryShape = {
	/** Every volume the engine reports, with the containers that mount it. */
	readonly list: Effect.Effect<DockerVolume[], DockerError, DockerEngine>;
};

/** The volumes of the local engine. */
export class DockerVolumesRepository extends Context.Service<DockerVolumesRepository, DockerVolumesRepositoryShape>()(
	"runtime/DockerVolumesRepository",
) {
	/** The engine is yielded when `list` runs, so this is a constant a Nest module provides with `useValue`. */
	static readonly live = class DockerVolumesRepositoryImpl implements DockerVolumesRepositoryShape {
		list = Effect.gen(function* () {
			const engine = yield* DockerEngine;
			return yield* listDockerVolumes(engine);
		})
	};
}

/** Volume name -> ids of the containers mounting it. */
const mountsByVolume = (containers: readonly { readonly Id?: unknown; readonly Mounts?: unknown }[]): Map<string, string[]> => {
	const used = new Map<string, string[]>();
	for (const container of containers) {
		const containerId = String(container.Id ?? "");
		const mounts = (container.Mounts as Record<string, unknown>[] | undefined) ?? [];
		for (const mount of mounts) {
			const volumeName = typeof mount.Name === "string" ? mount.Name : undefined;
			if (volumeName === undefined || volumeName === "") continue;
			used.set(volumeName, [...(used.get(volumeName) ?? []), containerId]);
		}
	}
	return used;
};

const listDockerVolumes = (engine: DockerEngineShape): Effect.Effect<DockerVolume[], DockerError> =>
	Effect.suspend(() => Effect.all([engine.volumes.list(), engine.containers.list({ all: true })], { concurrency: "unbounded" })).pipe(
			Effect.map(([volumes, containers]) => {
				const used = mountsByVolume(containers as readonly { Id?: unknown; Mounts?: unknown }[]);
				return volumes.map((volume) => {
					const driver = String(volume.Driver ?? "local");
					const size = (volume.UsageData as { Size?: unknown } | undefined)?.Size;
					return dockerVolumeSchema.parse({
						id: String(volume.Name ?? volume.Driver ?? "unknown-volume"),
						name: String(volume.Name ?? "unknown-volume"),
						driver: VOLUME_DRIVERS.includes(driver) ? (driver as DockerVolume["driver"]) : "custom",
						mountpoint: typeof volume.Mountpoint === "string" ? volume.Mountpoint : null,
						sizeBytes: typeof size === "number" ? size : null,
						usedByContainerIds: used.get(String(volume.Name ?? "")) ?? [],
						labels: volume.Labels ?? {},
						createdAt: typeof volume.CreatedAt === "string" ? new Date(volume.CreatedAt).toISOString() : new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					});
				});
			}),
		);
