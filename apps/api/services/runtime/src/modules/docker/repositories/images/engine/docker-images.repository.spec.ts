import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { DockerEngine } from "@deployer/docker";

import { DockerImagesRepository } from "./docker-images.repository";

const engineWith = (images: unknown[]) => ({ images: { list: () => Effect.succeed(images) } }) as never;
const list = (images: unknown[]) => Effect.runPromise(withEngine(engineWith(images)).list);

const withEngine = (engine: never) => ({ list: new DockerImagesRepository.live().list.pipe(Effect.provideService(DockerEngine, engine)) });

describe("DockerImagesRepository", () => {
	it("splits a tagged reference into registry, repository and tag", async () => {
		const [image] = await list([
			{ Id: "sha256:abc", RepoTags: ["ghcr.io/acme/web:1.2.3"], RepoDigests: ["ghcr.io/acme/web@sha256:deadbeef"], Size: 1024, Created: 1_700_000_000, Labels: { a: "b" } },
		]);
		expect(image).toMatchObject({
			id: "sha256:abc",
			registry: "ghcr.io",
			repository: "acme/web",
			tag: "1.2.3",
			digest: "ghcr.io/acme/web@sha256:deadbeef",
			sizeBytes: 1024,
			labels: { a: "b" },
		});
	});

	it("defaults the registry to docker.io for a bare name", async () => {
		const [image] = await list([{ Id: "sha256:1", RepoTags: ["nginx:latest"], Created: 1_700_000_000 }]);
		expect(image).toMatchObject({ registry: "docker.io", repository: "nginx", tag: "latest" });
	});

	it("gives an untagged image a local, id-derived repository", async () => {
		const [image] = await list([{ Id: "sha256:0123456789abcdef", RepoTags: ["<none>:<none>"], Created: 1_700_000_000 }]);
		expect(image).toMatchObject({ registry: "local", repository: "untagged/0123456789ab", tag: null });
	});

	it("skips an entry that does not fit the entity instead of failing the list", async () => {
		const images = await list([{ Id: "sha256:ok", RepoTags: ["a/b:1"], Created: 1_700_000_000 }, { Id: "sha256:bad", RepoTags: ["a/b:1"], Created: 1, Size: "huge" }]);
		expect(images.map((item) => item.id)).toContain("sha256:ok");
	});
});
