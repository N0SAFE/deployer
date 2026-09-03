import { describe, expect, it } from 'vitest'
import {
  buildDockerEntityEventChunk,
  dockerEntityStreamChunkSchema,
} from '../entities/docker/entity-events.schema'
import { dockerContainerSchema } from '../entities/docker/containers'
import type { DockerContainerEntity } from '../entities/docker/containers'
import type { DockerImageEntity } from '../entities/docker/images'
import type { DockerNetworkEntity } from '../entities/docker/networks'
import type { DockerVolumeEntity } from '../entities/docker/volumes'

const occurredAt = '2026-08-04T13:21:52.655Z'

/**
 * Minimal but valid base-entity payloads for every kind. These match the
 * shapes the API produces when it hydrates a `docker.entity.list` /
 * `docker.entity.inspect` response (base entity + envelope fields).
 */
// Parsed through the schema so defaulted fields (managed*, ports, ...) are filled.
const containerEntity: DockerContainerEntity = dockerContainerSchema.parse({
  id: 'abc123',
  hash: 'abc123',
  name: 'web',
  projectId: 'p1',
  serviceId: 's1',
  stackId: null,
  imageId: 'img1',
  status: 'running',
  health: 'healthy',
  environment: null,
  cpuPercent: null,
  memoryPercent: null,
  restartCount: 0,
  logsStreamId: null,
  startedAt: null,
  createdAt: '2026-08-04T13:00:00.000Z',
  updatedAt: '2026-08-04T13:00:00.000Z',
})

const imageEntity: DockerImageEntity = {
  id: 'sha256:1e71065c0a4cff3e6bd3b8add525ffac4343eb4971694eb90a31cf6d4d3e85db',
  registry: 'docker.io',
  repository: 'anchore/grype',
  tag: 'latest',
  digest: 'anchore/grype@sha256:1e71065c0a4cff3e6bd3b8add525ffac4343eb4971694eb90a31cf6d4d3e85db',
  sizeBytes: 119821738,
  createdAt: '2026-07-28T21:40:51.000Z',
  lastSeenAt: '2026-08-04T13:21:52.654Z',
  labels: {},
}

const networkEntity: DockerNetworkEntity = {
  id: 'net1',
  name: 'bridge',
  driver: 'bridge',
  scope: 'local',
  internal: false,
  attachable: true,
  subnet: null,
  gateway: null,
  containerIds: [],
  labels: {},
  createdAt: '2026-08-04T13:00:00.000Z',
  updatedAt: '2026-08-04T13:00:00.000Z',
}

const volumeEntity: DockerVolumeEntity = {
  id: 'vol1',
  name: 'data',
  driver: 'local',
  mountpoint: null,
  sizeBytes: null,
  usedByContainerIds: [],
  labels: {},
  createdAt: '2026-08-04T13:00:00.000Z',
  updatedAt: '2026-08-04T13:00:00.000Z',
}

/**
 * Every chunk built by `buildDockerEntityEventChunk` must re-parse against
 * `dockerEntityStreamChunkSchema` — the exact union ORPC uses to validate
 * the `docker.entity.list` / `docker.entity.inspect` / `docker.entity.stream`
 * outputs on the wire.
 */
function expectChunkContractConformant(chunk: unknown): void {
  const parsed = dockerEntityStreamChunkSchema.safeParse(chunk)
  expect(parsed.success).toBe(true)
  if (parsed.success) {
    expect(parsed.data).toEqual(chunk)
  }
}

describe('buildDockerEntityEventChunk', () => {
  it('builds a container chunk carrying the kind discriminator', () => {
    const chunk = buildDockerEntityEventChunk({
      kind: 'container',
      entity: containerEntity,
      action: 'snapshot',
      occurredAt,
      eventId: null,
    })

    expect(chunk.kind).toBe('container')
    expect(chunk.action).toBe('snapshot')
    expect(chunk.occurredAt).toBe(occurredAt)
    expect(chunk.eventId).toBeNull()
    expectChunkContractConformant(chunk)
  })

  it('builds an image chunk carrying the kind discriminator', () => {
    const chunk = buildDockerEntityEventChunk({
      kind: 'image',
      entity: imageEntity,
      action: 'snapshot',
      occurredAt,
      eventId: null,
    })

    expect(chunk.kind).toBe('image')
    expect(chunk.action).toBe('snapshot')
    expect(chunk.occurredAt).toBe(occurredAt)
    expect(chunk.eventId).toBeNull()
    expectChunkContractConformant(chunk)
  })

  it('builds a network chunk carrying the kind discriminator', () => {
    const chunk = buildDockerEntityEventChunk({
      kind: 'network',
      entity: networkEntity,
      action: 'snapshot',
      occurredAt,
      eventId: null,
    })

    expect(chunk.kind).toBe('network')
    expect(chunk.action).toBe('snapshot')
    expect(chunk.occurredAt).toBe(occurredAt)
    expect(chunk.eventId).toBeNull()
    expectChunkContractConformant(chunk)
  })

  it('builds a volume chunk carrying the kind discriminator', () => {
    const chunk = buildDockerEntityEventChunk({
      kind: 'volume',
      entity: volumeEntity,
      action: 'snapshot',
      occurredAt,
      eventId: null,
    })

    expect(chunk.kind).toBe('volume')
    expect(chunk.action).toBe('snapshot')
    expect(chunk.occurredAt).toBe(occurredAt)
    expect(chunk.eventId).toBeNull()
    expectChunkContractConformant(chunk)
  })

  it('rejects a payload missing the kind discriminator (regression: ORPC output validation 500)', () => {
    // This is exactly the shape the buggy builder used to produce:
    // `{ ...entity, action, occurredAt, eventId }` with no `kind` — which
    // ORPC's `dockerEntityStreamChunkSchema` union rejects on every element.
    const missingKind = {
      ...imageEntity,
      action: 'snapshot',
      occurredAt,
      eventId: null,
    }
    expect(dockerEntityStreamChunkSchema.safeParse(missingKind).success).toBe(false)
  })

  it('throws when the entity does not match the declared kind', () => {
    // `as never` is deliberate: we exercise the runtime guard with a shape
    // the statically-typed overloads would not admit.
    expect(() =>
      buildDockerEntityEventChunk({
        kind: 'image',
        entity: containerEntity as never,
        action: 'snapshot',
        occurredAt,
        eventId: null,
      }),
    ).toThrow()
  })

  it('throws when the action is empty', () => {
    expect(() =>
      buildDockerEntityEventChunk({
        kind: 'image',
        entity: imageEntity,
        action: '',
        occurredAt,
        eventId: null,
      }),
    ).toThrow()
  })
})
