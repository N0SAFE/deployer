import { describe, expect, it } from 'vitest'
import { deploymentSchema } from '../entities/deployment.schema'
import { dockerPortBindingSchema } from '../entities/docker.schema'
import { userSchema } from '../entities/user.schema'
import { templateVersionSchema } from '../entities/template.schema'
import { setupInitializeInputSchema } from '../entities/setup.schema'
import { coreDomainEventEnvelopeSchema } from '../entities/event-stream.schema'
import { meshPeerSessionSchema } from '../entities/mesh.schema'
import { traefikServiceSchema } from '../entities/traefik.schema'

describe('deployment schema validation', () => {
  it('accepts minimal valid deployment payload', () => {
    const result = deploymentSchema.safeParse({
      id: '11111111-1111-4111-8111-111111111111',
      serviceId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: null,
      status: 'queued',
      environment: 'production',
      sourceType: 'git',
      sourceConfig: null,
      containerName: null,
      containerImage: null,
      domainUrl: null,
      healthCheckUrl: null,
      errorMessage: null,
      observability: null,
      progress: null,
      connectivityStatus: null,
      buildStartedAt: null,
      buildCompletedAt: null,
      deployStartedAt: null,
      deployCompletedAt: null,
      metadata: null,
      createdAt: '2026-03-27T10:00:00Z',
      updatedAt: '2026-03-27T10:00:00Z',
    })

    expect(result.success).toBe(true)
  })

  it('rejects invalid deployment id', () => {
    const result = deploymentSchema.safeParse({
      id: 'not-a-uuid',
      serviceId: '22222222-2222-4222-8222-222222222222',
      triggeredBy: null,
      status: 'queued',
      environment: 'production',
      sourceType: 'git',
      sourceConfig: null,
      containerName: null,
      containerImage: null,
      domainUrl: null,
      healthCheckUrl: null,
      errorMessage: null,
      observability: null,
      progress: null,
      connectivityStatus: null,
      buildStartedAt: null,
      buildCompletedAt: null,
      deployStartedAt: null,
      deployCompletedAt: null,
      metadata: null,
      createdAt: '2026-03-27T10:00:00Z',
      updatedAt: '2026-03-27T10:00:00Z',
    })

    expect(result.success).toBe(false)
  })
})

describe('docker schema validation', () => {
  it('rejects invalid port range', () => {
    const result = dockerPortBindingSchema.safeParse({
      containerPort: 70000,
      hostPort: 8080,
      protocol: 'tcp',
    })

    expect(result.success).toBe(false)
  })
})

describe('user schema validation', () => {
  it('rejects invalid email format', () => {
    const result = userSchema.safeParse({
      id: 'usr_1',
      name: 'Test User',
      email: 'not-an-email',
      emailVerified: false,
      image: null,
      createdAt: '2026-03-27T10:00:00Z',
      updatedAt: '2026-03-27T10:00:00Z',
    })

    expect(result.success).toBe(false)
  })
})

describe('template schema validation', () => {
  it('enforces semver for template versions', () => {
    expect(templateVersionSchema.safeParse('1.2.3').success).toBe(true)
    expect(templateVersionSchema.safeParse('v1').success).toBe(false)
  })
})

describe('setup schema validation', () => {
  it('rejects weak initial password', () => {
    const result = setupInitializeInputSchema.safeParse({
      strategy: 'local_instance',
      name: 'Owner',
      email: 'owner@example.com',
      password: 'short',
    })

    expect(result.success).toBe(false)
  })
})

describe('event-stream schema validation', () => {
  it('rejects non-uuid eventId in domain event envelope', () => {
    const result = coreDomainEventEnvelopeSchema.safeParse({
      eventId: 'evt-1',
      aggregateType: 'deployment',
      aggregateId: 'dep_1',
      eventType: 'deployment.created',
      version: '1',
      occurredAt: '2026-03-27T10:00:00Z',
      payload: {},
    })

    expect(result.success).toBe(false)
  })
})

describe('mesh schema validation', () => {
  it('rejects invalid peer endpoint URL', () => {
    const result = meshPeerSessionSchema.safeParse({
      sessionId: '11111111-1111-4111-8111-111111111111',
      peerNodeId: null,
      endpointUrl: 'not-a-url',
      state: 'connected',
      reconnectAttempt: 0,
      nextReconnectAt: null,
      resumeToken: 'token-1',
      duplicateSuppressed: false,
      duplicateOfSessionId: null,
      connectedAt: null,
      disconnectedAt: null,
      lastHeartbeatAt: null,
      metadata: null,
    })

    expect(result.success).toBe(false)
  })
})

describe('traefik schema validation', () => {
  it('rejects invalid upstream URL in service config', () => {
    const result = traefikServiceSchema.safeParse({
      name: 'svc-web',
      loadBalancer: {
        servers: [{ url: 'invalid-url' }],
      },
    })

    expect(result.success).toBe(false)
  })
})
