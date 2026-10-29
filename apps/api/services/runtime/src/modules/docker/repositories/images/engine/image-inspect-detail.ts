/**
 * An image's inspect detail, built from the engine's own description, the containers that use it and its
 * security scan. Pure: the engine and scanner calls live elsewhere, so every mapping rule is tested on plain data.
 */
import {
  dockerImageInspectDetailSchema,
  type DockerodeContainerList,
  type DockerodeImageInspect,
} from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

import type { ResolvedImageSecurityScan } from "../security/docker-image-scanner.types";
import {
  buildFallbackImageRepository,
  normalizeImageDigest,
  parseRegistryAndRepository,
  resolvePrimaryImageTag,
} from "./docker-image-identity";
import { toStringArray } from "./docker-image-reference";

/** Who the engine says this image is: its id, tags, digests and the registry/repository they imply. */
export type InspectedImageIdentity = {
  readonly inspectId: string;
  readonly repoTags: string[];
  readonly repoDigests: string[];
  readonly registry: string;
  readonly repository: string;
  readonly tag: string | null;
};

export function identifyInspectedImage(inspect: DockerodeImageInspect, requestedId: string): InspectedImageIdentity {
  const inspectId = typeof inspect.Id === "string" && inspect.Id.length > 0 ? inspect.Id : requestedId;
  const repoTags = toStringArray(inspect.RepoTags as string | string[] | undefined).filter(
    (tag) => tag !== "<none>:<none>",
  );
  const repoDigests = toStringArray(inspect.RepoDigests);
  const resolvedPrimaryTag = resolvePrimaryImageTag(repoTags, repoDigests);
  const fallbackRepository = buildFallbackImageRepository(inspectId);
  const parsedPrimary = resolvedPrimaryTag
    ? parseRegistryAndRepository(resolvedPrimaryTag)
    : { registry: "local", repository: fallbackRepository, tag: null };
  const repository = parsedPrimary.repository === "library/unknown" ? fallbackRepository : parsedPrimary.repository;

  return { inspectId, repoTags, repoDigests, registry: parsedPrimary.registry, repository, tag: parsedPrimary.tag };
}

/** The references a scan result may be stored under: the id first, then every tag, without blanks or repeats. */
export function scanTargetsOf(identity: InspectedImageIdentity): string[] {
  return [identity.inspectId, ...identity.repoTags]
    .map((candidate) => candidate.trim())
    .filter((candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index);
}

/** Ids of the containers running this image, matched by image id or by one of its tags. */
export function containersUsingImage(
  containers: readonly DockerodeContainerList[],
  identity: InspectedImageIdentity,
): string[] {
  const used = containers
    .filter((container) => {
      const containerImageId = container.ImageID ?? "";
      if (containerImageId.length > 0 && containerImageId === identity.inspectId) {
        return true;
      }
      return identity.repoTags.includes(container.Image ?? "");
    })
    .map((container) => container.Id)
    .filter((id) => id.length > 0);
  return [...new Set(used)];
}

export function buildImageInspectDetail(input: {
  readonly inspect: DockerodeImageInspect;
  readonly identity: InspectedImageIdentity;
  readonly generatedAt: string;
  readonly usedByContainerIds: readonly string[];
  readonly securityScan: Pick<ResolvedImageSecurityScan, "vulnerabilities" | "scanSummary">;
}) {
  const { inspect, identity, generatedAt, securityScan } = input;
  const labels = isRecord(inspect.Config) && isRecord(inspect.Config.Labels) ? inspect.Config.Labels : {};
  const rootFs = isRecord(inspect.RootFS) ? inspect.RootFS : {};
  const config = isRecord(inspect.Config) ? inspect.Config : {};

  const createdAt =
    typeof inspect.Created === "string" && !Number.isNaN(Date.parse(inspect.Created))
      ? new Date(inspect.Created).toISOString()
      : generatedAt;

  const layers = toStringArray(rootFs.Layers as string | string[] | undefined).map((layerId, index) => ({
    id: layerId,
    instruction: `LAYER ${String(index + 1)}`,
    size: "unknown",
    createdAt,
  }));

  return dockerImageInspectDetailSchema.parse({
    imageId: identity.inspectId,
    generatedAt,
    registry: identity.registry,
    repository: identity.repository,
    tag: identity.tag,
    digest: normalizeImageDigest(identity.repoDigests[0] ?? null),
    sizeBytes: typeof inspect.Size === "number" ? inspect.Size : null,
    createdAt,
    lastSeenAt: generatedAt,
    labels,
    architecture: typeof inspect.Architecture === "string" ? inspect.Architecture : null,
    os: typeof inspect.Os === "string" ? inspect.Os : null,
    variant: typeof inspect.Variant === "string" ? inspect.Variant : null,
    author: typeof inspect.Author === "string" ? inspect.Author : null,
    comment: typeof inspect.Comment === "string" ? inspect.Comment : null,
    dockerVersion: typeof inspect.DockerVersion === "string" ? inspect.DockerVersion : null,
    rootFsType: typeof rootFs.Type === "string" ? rootFs.Type : null,
    repoTags: identity.repoTags,
    repoDigests: identity.repoDigests,
    layers,
    vulnerabilities: securityScan.vulnerabilities,
    scanSummary: securityScan.scanSummary ?? null,
    usedByContainerIds: [...input.usedByContainerIds],
    runtimeConfig: {
      env: toStringArray(config.Env),
      exposedPorts:
        typeof config.ExposedPorts === "object" && config.ExposedPorts !== null
          ? Object.keys(config.ExposedPorts)
          : [],
      workingDir: typeof config.WorkingDir === "string" ? config.WorkingDir : null,
      user: typeof config.User === "string" && config.User.length > 0 ? config.User : null,
      entrypoint: toStringArray(config.Entrypoint),
      command: toStringArray(config.Cmd),
    },
  });
}
