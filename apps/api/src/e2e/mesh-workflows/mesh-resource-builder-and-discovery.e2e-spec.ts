import { Test, type TestingModule } from '@nestjs/testing'
import { beforeAll, describe, expect, it } from 'vitest'
import z from 'zod/v4'
import { defineResource } from '@/core/modules/mesh/mesh-resource-definition'
import { TestDeploymentMeshModule } from '@/core/modules/mesh/examples/test-deployment-mesh.module'
import { TestDeploymentConsumerService } from '@/core/modules/mesh/examples/test-deployment-consumer.service'
import { TestDeploymentMeshService } from '@/core/modules/mesh/examples/test-deployment-mesh.service'
import { SystemMeshResourceDiscoveryService } from '@/core/modules/mesh/services/system-mesh-resource-discovery/system-mesh-resource-discovery.service'

describe('real mesh resource builder and discovery e2e', () => {
  let moduleRef: TestingModule
  let discovery: SystemMeshResourceDiscoveryService
  let consumer: TestDeploymentConsumerService

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [TestDeploymentMeshModule],
    }).compile()

    discovery = moduleRef.get(SystemMeshResourceDiscoveryService)
    consumer = moduleRef.get(TestDeploymentConsumerService)
  }, 120_000)

  it('builds a real mesh resource definition with ownership, queries, mutations, and events', () => {
    const resource = defineResource()
      .key('projects')
      .itemSchema(
        z.object({
          projectId: z.string(),
          name: z.string(),
          ownerId: z.string(),
        })
      )
      .itemKey('projectId')
      .globalOwnership('mesh-coordinator')
      .addQuery('list', {
        inputSchema: z.object({ organizationId: z.string().optional() }),
        outputSchema: z.object({ total: z.number() }),
        capabilities: {
          request: true,
          listen: true,
          paginate: true,
          sort: true,
          filter: true,
          project: true,
        },
        defaultLimit: 100,
      })
      .addMutation('archive', {
        inputSchema: z.object({ projectId: z.string() }),
        outputSchema: z.object({ success: z.boolean() }),
        capabilities: {
          returnsItem: false,
          batchable: false,
          emitsEvents: true,
          optimisticUpdates: false,
        },
      })
      .addEventSource('changes', {
        type: 'external',
        schema: z.object({ projectId: z.string(), kind: z.literal('changed') }),
        emitsCreated: false,
        emitsUpdated: true,
        emitsDeleted: false,
        config: {
          system: 'project-service',
          webhookPath: '/webhooks/projects',
        },
      })
      .build()

    expect(resource.key).toBe('projects')
    expect(resource.itemKey).toBe('projectId')
    expect(resource.ownership).toEqual({
      type: 'global',
      coordinatorNode: 'mesh-coordinator',
    })
    expect(resource.queries.list).toBeDefined()
    expect(resource.mutations.archive).toBeDefined()
    expect(resource.eventSources.changes).toBeDefined()
  })

  it('creates typed query builders from the real discovery service', async () => {
    const builder = discovery.from(TestDeploymentMeshService.queries.deployments)

    expect(typeof builder.where).toBe('function')
    expect(typeof builder.select).toBe('function')
    expect(typeof builder.orderBy).toBe('function')
    expect(typeof builder.execute).toBe('function')

    const result = await builder
      .where({ environment: 'prod', status: 'running' })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .execute()

    expect(Array.isArray(result.items)).toBe(true)
    expect(typeof result.total).toBe('number')
    expect(typeof result.strategy).toBe('string')
  }, 120_000)

  it('supports queryWithInput and query convenience APIs from the same discovery service', async () => {
    const searchResult = await discovery.queryWithInput(
      TestDeploymentMeshService.queries.searchDeployments,
      {
        query: 'deployment',
        filters: {
          environment: 'prod',
          healthy: true,
        },
      }
    )

    expect(Array.isArray(searchResult.items)).toBe(true)
    expect(typeof searchResult.total).toBe('number')

    const listResult = await discovery.query(
      TestDeploymentMeshService.queries.deployments,
      { environment: 'prod' }
    )

    expect(Array.isArray(listResult.items)).toBe(true)
    expect(typeof listResult.total).toBe('number')
  }, 120_000)

  it('uses the consumer service built on top of real discovery builders', async () => {
    const running = await consumer.getRunningProductionDeployments()
    const summaries = await consumer.getDeploymentSummaries()
    const report = await consumer.generateHealthReport()

    expect(Array.isArray(running.items)).toBe(true)
    expect(running.items.every((item) => item.environment === 'prod')).toBe(true)
    expect(summaries.length).toBeGreaterThan(0)
    expect(report.totalDeployments).toBeGreaterThanOrEqual(0)
    expect(report.healthyCount + report.unhealthyCount).toBe(report.totalDeployments)
  }, 120_000)
})