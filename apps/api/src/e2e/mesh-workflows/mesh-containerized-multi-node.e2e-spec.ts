import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSharedSetupOrpcClient,
  getSharedApiRuntimeContext,
  stopSharedApiRuntime,
  type SharedApiRuntimeContext,
} from '@/e2e/utils/shared-api-runtime'

type RuntimeCase = {
  instanceKey: string
  context: SharedApiRuntimeContext
}

describe('shared-runtime multi-port mesh e2e', () => {
  const runtimes: RuntimeCase[] = []

  beforeAll(async () => {
    const instanceKeys = ['mesh-node-a', 'mesh-node-b', 'mesh-node-c']

    for (const instanceKey of instanceKeys) {
      const context = await getSharedApiRuntimeContext({ instanceKey })
      runtimes.push({ instanceKey, context })
    }
  }, 120_000)

  afterAll(async () => {
    await Promise.all(
      runtimes.map(({ instanceKey }) => stopSharedApiRuntime({ instanceKey }))
    )
  })

  it('starts three isolated shared runtimes on distinct ports', async () => {
    const baseUrls = runtimes.map(({ context }) => context.runtime.baseUrl)
    const ports = baseUrls.map((baseUrl) => new URL(baseUrl).port)

    expect(new Set(baseUrls).size).toBe(3)
    expect(new Set(ports).size).toBe(3)

    const responses = await Promise.all(
      runtimes.map(async ({ context }) => {
        const response = await fetch(new URL('/setup/status', context.runtime.baseUrl))
        expect(response.status).toBe(200)

        const body = (await response.json()) as { needsSetup: boolean }
        expect(typeof body.needsSetup).toBe('boolean')

        return body
      })
    )
    
    console.log(responses)

    expect(responses).toHaveLength(3)
  }, 120_000)

  it('uses the real ORPC setup contract per runtime and keeps response trackers isolated', async () => {
    const first = runtimes[0]
    const second = runtimes[1]

    if (!first || !second) {
      throw new Error('expected at least two shared runtimes')
    }

    first.context.orpcTracker.clear()
    second.context.orpcTracker.clear()

    const firstSetupClient = await createSharedSetupOrpcClient(
      { tracker: first.context.orpcTracker },
      { instanceKey: first.instanceKey }
    )
    const secondSetupClient = await createSharedSetupOrpcClient(
      { tracker: second.context.orpcTracker },
      { instanceKey: second.instanceKey }
    )

    const [firstStatus, secondStatus] = await Promise.all([
      firstSetupClient.getState(),
      secondSetupClient.getState(),
    ])

    expect(typeof firstStatus.needsSetup).toBe('boolean')
    expect(typeof secondStatus.needsSetup).toBe('boolean')

    const firstMeta = first.context.orpcTracker.getLast()
    const secondMeta = second.context.orpcTracker.getLast()

    expect(firstMeta?.status).toBe(200)
    expect(secondMeta?.status).toBe(200)
    expect(firstMeta?.requestUrl).toContain('/getState')
    expect(secondMeta?.requestUrl).toContain('/getState')
    expect(firstMeta?.requestUrl).not.toBe(secondMeta?.requestUrl)
  }, 120_000)

  it('keeps the Bun fetch path and ORPC path aligned for the same runtime', async () => {
    const runtime = runtimes[0]

    if (!runtime) {
      throw new Error('expected one shared runtime')
    }

    const [httpResponse, orpcResponse] = await Promise.all([
      fetch(new URL('/setup/status', runtime.context.runtime.baseUrl)),
      runtime.context.orpc.setup.getState(),
    ])

    expect(httpResponse.status).toBe(200)
    const httpPayload = (await httpResponse.json()) as { needsSetup: boolean }

    expect(typeof httpPayload.needsSetup).toBe('boolean')
    expect(orpcResponse.needsSetup).toBe(httpPayload.needsSetup)
  }, 120_000)
})
