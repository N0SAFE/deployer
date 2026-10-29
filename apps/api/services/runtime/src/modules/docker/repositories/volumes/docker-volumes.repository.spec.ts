import { DockerEngine } from "@deployer/docker";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DockerVolumesRepository } from "./docker-volumes.repository";

const engineWith = (volumes: unknown[], containers: unknown[]) =>
	({ volumes: { list: () => Effect.succeed(volumes) }, containers: { list: () => Effect.succeed(containers) } }) as never;

const withEngine = (engine: never) => ({ list: DockerVolumesRepository.live.list.pipe(Effect.provideService(DockerEngine, engine)) });

describe("DockerVolumesRepository", () => {
	it("maps a volume and lists the containers that mount it", async () => {
		const repository = withEngine(
			engineWith(
				[{ Name: "data", Driver: "local", Mountpoint: "/var/lib/docker/volumes/data/_data", UsageData: { Size: 2048 }, Labels: { a: "b" }, CreatedAt: "2026-10-02T00:00:00.000Z" }],
				[
					{ Id: "c1", Mounts: [{ Name: "data" }, { Name: "other" }] },
					{ Id: "c2", Mounts: [{ Name: "data" }] },
					{ Id: "c3", Mounts: [{ Source: "/bind" }] },
				],
			),
		);

		const [volume] = await Effect.runPromise(repository.list);

		expect(volume).toMatchObject({
			id: "data",
			name: "data",
			driver: "local",
			mountpoint: "/var/lib/docker/volumes/data/_data",
			sizeBytes: 2048,
			usedByContainerIds: ["c1", "c2"],
			labels: { a: "b" },
			createdAt: "2026-10-02T00:00:00.000Z",
		});
	});

	it("reports an unused volume with no size when the engine has no usage data", async () => {
		const [volume] = await Effect.runPromise(withEngine(engineWith([{ Name: "idle", Driver: "rexray" }], [])).list);
		expect(volume).toMatchObject({ driver: "custom", sizeBytes: null, usedByContainerIds: [], mountpoint: null });
	});
});
