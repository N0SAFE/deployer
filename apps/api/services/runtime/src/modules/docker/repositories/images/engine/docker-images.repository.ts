import { Context, Data, Effect } from "effect";

import {
	dockerImageSchema,
	dockerodeImageInspectSchema,
	type DockerImage,
	type DockerodeImageInspect,
} from "@deployer/contracts-entities";
import type { DockerEngineShape, DockerError } from "@deployer/docker";
import { DockerEngine } from "@deployer/docker";

import {
	buildFallbackImageRepository,
	normalizeImageDigest,
	parseRegistryAndRepository,
	resolvePrimaryImageTag,
} from "./docker-image-identity";
import { buildImageInspectCandidates, buildImageInspectCandidatesFromImageList } from "./docker-image-reference";

/** No image the engine knows matches this reference. */
export class ImageNotFound extends Data.TaggedError("ImageNotFound")<{ readonly imageId: string }> {}

export type DockerImagesRepositoryShape = {
	/** Every image the engine reports, as the runtime's image entity. Entries that do not fit the entity are skipped and logged. */
	readonly list: Effect.Effect<DockerImage[], DockerError, DockerEngine>;
	/**
	 * The engine's description of an image, found from whatever reference was given: the reference itself and its
	 * canonical spellings first, then the engine's own image list. Fails with `ImageNotFound` when none inspects.
	 */
	readonly inspectResolved: (imageId: string) => Effect.Effect<DockerodeImageInspect, ImageNotFound | DockerError, DockerEngine>;
};

/** The images of the local engine. */
export class DockerImagesRepository extends Context.Service<DockerImagesRepository, DockerImagesRepositoryShape>()(
	"runtime/DockerImagesRepository",
) {
	/** The engine is yielded when `list` runs, so this is a constant a Nest module provides with `useValue`. */
	static readonly live = class DockerImagesRepositoryImpl implements DockerImagesRepositoryShape {
		list = Effect.gen(function* () {
			const engine = yield* DockerEngine;
			return yield* listDockerImages(engine);
		})

		inspectResolved = (imageId) =>
			Effect.gen(function* () {
				const engine = yield* DockerEngine;
				// A candidate the engine cannot inspect, or describes in a shape we do not read, is skipped.
				const tryCandidates = Effect.fnUntraced(function* (candidates: readonly string[]) {
					for (const candidate of candidates) {
						const raw = yield* engine.images.inspect(candidate).pipe(Effect.orElseSucceed(() => null));
						const parsed = dockerodeImageInspectSchema.safeParse(raw);
						if (parsed.success) return parsed.data;
					}
					return null;
				});

				const direct = yield* tryCandidates(buildImageInspectCandidates(imageId));
				if (direct !== null) return direct;

				const images = yield* engine.images.list();
				const resolved = yield* tryCandidates(buildImageInspectCandidatesFromImageList(imageId, images));
				if (resolved !== null) return resolved;

				return yield* Effect.fail(new ImageNotFound({ imageId }));
			})
	};
}

const stringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

const listDockerImages = (engine: DockerEngineShape): Effect.Effect<DockerImage[], DockerError> =>
	Effect.suspend(() => engine.images.list()).pipe(
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
		);
