import { Injectable, Logger } from "@nestjs/common"
import { createHash } from "node:crypto"
import type {
  DockerContainer,
  DockerContainerEntity,
  DockerImage,
  DockerImageEntity,
  DockerNetwork,
  DockerNetworkEntity,
  DockerVolume,
  DockerVolumeEntity,
  DockerEntityKind,
} from "@repo/contracts-entities"

/**
 * Tiny TTL-bounded cache used by the unified `docker.entity` list endpoint.
 *
 * The list is fetched by every page that needs the inventory (containers,
 * images, networks, volumes, registries, stacks). Without caching, even a
 * 100-container page would translate to a mesh-wide fanout for every
 * navigation. The cache cuts this to one fetch per `ttlMs`.
 *
 * Implementation notes:
 *  - The cache is per-process. When the API runs in cluster mode each
 *    worker has its own copy — that's fine because the mesh layer
 *    consolidates the data anyway and the list rarely changes within the
 *    TTL window.
 *  - Entries are JSON-serialized so we can compute a stable ETag.
 *  - `etag()` produces a short fingerprint the client can use to skip
 *    re-rendering when the snapshot is unchanged.
 */
@Injectable()
export class DockerEntityCacheService {
  private static readonly DEFAULT_TTL_MS = 2_000
  private readonly logger = new Logger(DockerEntityCacheService.name)

  private readonly entries = new Map<
    DockerEntityKind,
    {
      expiresAt: number
      payload: unknown
      etag: string
    }
  >()

  getOrCompute<TPayload>(
    kind: DockerEntityKind,
    compute: () => Promise<{ payload: TPayload; ttlMs?: number }>,
  ): Promise<{ payload: TPayload; etag: string; hit: boolean }> {
    const cached = this.entries.get(kind)
    const now = Date.now()
    if (cached && cached.expiresAt > now) {
      return Promise.resolve({
        payload: cached.payload as TPayload,
        etag: cached.etag,
        hit: true,
      })
    }

    return compute().then(({ payload, ttlMs }) => {
      const etag = this.computeEtag(payload)
      const ttl = Math.max(0, ttlMs ?? DockerEntityCacheService.DEFAULT_TTL_MS)
      this.entries.set(kind, {
        expiresAt: now + ttl,
        payload,
        etag,
      })
      return { payload, etag, hit: false }
    })
  }

  invalidate(kind?: DockerEntityKind) {
    if (kind) {
      this.entries.delete(kind)
      return
    }
    this.entries.clear()
  }

  private computeEtag(payload: unknown): string {
    try {
      return `"${createHash("sha1").update(JSON.stringify(payload)).digest("base64url").slice(0, 16)}"`
    } catch (error) {
      this.logger.warn(
        `Failed to compute etag: ${error instanceof Error ? error.message : String(error)}`,
      )
      return `"${Date.now().toString(36)}"`
    }
  }
}

export type DockerEntityKindPayload<K extends DockerEntityKind> =
  K extends "container"
    ? DockerContainerEntity
    : K extends "image"
      ? DockerImageEntity
      : K extends "network"
        ? DockerNetworkEntity
        : K extends "volume"
          ? DockerVolumeEntity
          : never

export type DockerEntityFlatKindPayload<K extends DockerEntityKind> =
  K extends "container"
    ? DockerContainer
    : K extends "image"
      ? DockerImage
      : K extends "network"
        ? DockerNetwork
        : K extends "volume"
          ? DockerVolume
          : never
