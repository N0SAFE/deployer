/**
 * How the engine's image references become a registry, a repository and a tag. Pure, so listing and inspecting
 * images agree on the same identity.
 */

export function parseRegistryAndRepository(repoTag: string): {
  registry: string;
  repository: string;
  tag: string | null;
} {
  const normalizedRepoTag = repoTag.trim();
  const withoutDigest = normalizedRepoTag.includes("@")
    ? normalizedRepoTag.slice(0, normalizedRepoTag.indexOf("@"))
    : normalizedRepoTag;

  const lastSlashIndex = withoutDigest.lastIndexOf("/");
  const lastColonIndex = withoutDigest.lastIndexOf(":");
  const hasTagSuffix = lastColonIndex > lastSlashIndex;

  const namePart = hasTagSuffix ? withoutDigest.slice(0, lastColonIndex) : withoutDigest;
  const tagPart = hasTagSuffix ? withoutDigest.slice(lastColonIndex + 1) : null;

  const safeNamePart = namePart.length > 0 ? namePart : "library/unknown";
  const firstSegment = safeNamePart.split("/")[0] ?? "";
  const hasExplicitRegistry =
    firstSegment.includes(".") || firstSegment.includes(":") || firstSegment === "localhost";

  if (hasExplicitRegistry) {
    const [registry, ...repoParts] = safeNamePart.split("/");
    return {
      registry: normalizeImageRegistrySegment(registry),
      repository: normalizeImageRepositoryPath(repoParts.join("/")),
      tag: normalizeImageTag(tagPart),
    };
  }

  return {
    registry: "docker.io",
    repository: normalizeImageRepositoryPath(safeNamePart),
    tag: normalizeImageTag(tagPart),
  };
}

export function resolvePrimaryImageTag(repoTags: string[], repoDigests: string[] = []): string | null {
  const tagCandidates = repoTags
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0 && candidate !== "<none>:<none>");

  const digestCandidates = repoDigests
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0 && candidate !== "<none>@<none>")
    .map((candidate) => {
      const digestSeparatorIndex = candidate.indexOf("@");
      return digestSeparatorIndex === -1 ? candidate : candidate.slice(0, digestSeparatorIndex);
    })
    .filter((candidate) => candidate.length > 0);

  const candidates = [...tagCandidates, ...digestCandidates];

  for (const candidate of candidates) {
    const parsed = parseRegistryAndRepository(candidate);
    if (parsed.repository !== "library/unknown") {
      return candidate;
    }
  }

  return candidates[0] ?? null;
}

export function buildFallbackImageRepository(imageId: string): string {
  const normalizedId = imageId.replace(/^sha256:/, "").trim();
  const shortId = normalizedId.length > 0 ? normalizedId.slice(0, 12) : "unknown";
  return `untagged/${shortId}`;
}

export function normalizeImageRegistrySegment(value: string | null | undefined): string {
  const normalized = (value ?? "").trim();
  if (normalized.length === 0 || normalized === "<none>" || isPlaceholderImageSegment(normalized)) {
    return "docker.io";
  }

  return normalized;
}

export function normalizeImageRepositoryPath(value: string | null | undefined): string {
  const segments = (value ?? "")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== "<none>" && !isPlaceholderImageSegment(segment));

  if (segments.length === 0) {
    return "library/unknown";
  }

  return segments.join("/");
}

export function normalizeImageTag(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized === "<none>" || isPlaceholderImageSegment(normalized)) {
    return null;
  }

  return normalized;
}

export function normalizeImageDigest(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (normalized.length === 0 || normalized === "<none>" || isPlaceholderImageSegment(normalized)) {
    return null;
  }

  return normalized;
}

export function isPlaceholderImageSegment(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === "undefined" || normalized === "null" || normalized === "none" || normalized === "nan";
}

