import { dockerImageSchema, type DockerImage } from "@deployer/contracts-entities";
import type { DockerEngineShape, DockerError } from "@deployer/docker";
import { DockerEngine } from "@deployer/docker";
import { Context, Effect, Layer } from "effect";

import {
	buildFallbackImageRepository,
	normalizeImageDigest,
	parseRegistryAndRepository,
	resolvePrimaryImageTag,
} from "./docker-image-identity";

export type DockerImagesRepositoryShape = {
	/** Every image the engine reports, as the runtime's image entity. Entries that do not fit the entity are skipped and logged. */
	readonly list: Effect.Effect<DockerImage[], DockerError>;
};

/** The images of the local engine. */
export class DockerImagesRepository extends Context.Service<DockerImagesRepository, DockerImagesRepositoryShape>()(
	"runtime/DockerImagesRepository",
) {
	static readonly Live: Layer.Layer<DockerImagesRepository, never, DockerEngine> = Layer.effect(
		DockerImagesRepository,
		Effect.gen(function* () {
			return makeDockerImagesRepository(yield* DockerEngine);
		}),
	);
}

const stringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

export function makeDockerImagesRepository(engine: DockerEngineShape): DockerImagesRepositoryShape {
	return {
		list: Effect.suspend(() => engine.images.list()).pipe(
			Effect.flatMap((rawImages) =>
				Effect.gen(function* () {
					const mapped: DockerImage[] = [];
					for (const image of rawImages) {
						const imageId = image.Id.trim();
						const repoTags = (image.RepoTags ?? []).filter((tag) => tag !== "<none>:<none>");
						const repoDigests = stringArray(image.RepoDigests ?? []);
						const resolvedPrimaryTag = resolvePrimaryImageTag(repoTags, repoDigests);
						const fallbackRepository = buildFallbackImageRepository(imageId);
						const primaryTag = resolvedPrimaryTag ?? `local/${fallbackRepository}`;
						const parsed = resolvedPrimaryTag
							? parseRegistryAndRepository(primaryTag)
							: { registry: "local", repository: fallbackRepository, tag: null };
						const repository = parsed.repository === "library/unknown" ? fallbackRepository : parsed.repository;
						const digest = repoDigests.map((candidate) => normalizeImageDigest(candidate)).find((candidate): candidate is string => candidate !== null) ?? null;

						const entity = dockerImageSchema.safeParse({
							id: imageId,
							registry: parsed.registry,
							repository,
							tag: parsed.tag,
							digest,
							sizeBytes: typeof image.Size === "number" ? image.Size : null,
							createdAt: typeof image.Created === "number" ? new Date(image.Created * 1000).toISOString() : new Date().toISOString(),
							lastSeenAt: new Date().toISOString(),
							labels: image.Labels,
						});
						if (!entity.success) {
							yield* Effect.logWarning(`Skipping invalid docker image entry: ${JSON.stringify(entity.error.issues[0] ?? null)}`);
							continue;
						}
						mapped.push(entity.data);
					}
					return mapped;
				}),
			),
		),
	};
}
