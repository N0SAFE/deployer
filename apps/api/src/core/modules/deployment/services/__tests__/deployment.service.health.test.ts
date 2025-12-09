import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeploymentService } from '../deployment.service'

const createService = (overrides: Partial<{ checkContainerHealth: () => Promise<boolean> }> = {}) => {
  const dockerService = {
    checkContainerHealth: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as any

  const deploymentRepository = {} as any
  const serviceRepository = {} as any
  const providerRegistry = {} as any
  const builderRegistry = {} as any
  const databaseService = {
    transaction: vi.fn(async (handler: (tx: any) => Promise<unknown>) => handler({})),
  } as any

  const service = new DeploymentService(
    dockerService,
    deploymentRepository,
    serviceRepository,
    providerRegistry,
    builderRegistry,
    databaseService,
  ) as any

  return { service, dockerService }
}

describe('DeploymentService.verifyContainerHealth', () => {
  const originalFetch = (global as any).fetch
  let fetchMock: ReturnType<typeof vi.fn>
  let randomSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock = vi.fn()
    ;(global as any).fetch = fetchMock
    randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    vi.useRealTimers()
    randomSpy.mockRestore()
    ;(global as any).fetch = originalFetch
  })

  it('retries health checks with backoff and succeeds when a later attempt passes', async () => {
    const { service, dockerService } = createService()

    // Always report container healthy; HTTP recovers on 3rd attempt
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
      .mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' })

    const healthPromise = service.verifyContainerHealth('container-1', 'http://localhost:8080/health', {
      maxAttempts: 3,
      initialDelayMs: 10,
      maxDelayMs: 10,
      httpTimeoutMs: 50,
    })

    await vi.runAllTimersAsync()
    const result = await healthPromise

    expect(result).toBe(true)
    expect(dockerService.checkContainerHealth).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('fails after exhausting retries when health checks do not recover', async () => {
    const { service, dockerService } = createService()

    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error' })

    const healthPromise = service.verifyContainerHealth('container-2', 'http://localhost:8080/health', {
      maxAttempts: 2,
      initialDelayMs: 5,
      maxDelayMs: 5,
      httpTimeoutMs: 20,
    })

    await vi.runAllTimersAsync()
    const result = await healthPromise

    expect(result).toBe(false)
    expect(dockerService.checkContainerHealth).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
