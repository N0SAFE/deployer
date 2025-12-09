import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DeploymentOrchestrator } from '../deployment-orchestrator.service';

describe('DeploymentOrchestrator runHealthCheck', () => {
  let orchestrator: DeploymentOrchestrator;
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    orchestrator = new DeploymentOrchestrator();
    originalFetch = global.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch as typeof fetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns true when the health check succeeds on the first attempt', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = (orchestrator as any).runHealthCheck('http://service', {
      path: '/health',
      timeout: 500,
      retries: 2,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries failed attempts and succeeds before exhausting retries', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = (orchestrator as any).runHealthCheck('http://service', {
      path: '/health',
      timeout: 500,
      retries: 2,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns false after exhausting retries when health checks keep failing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 500 });
    global.fetch = fetchMock as unknown as typeof fetch;

    const resultPromise = (orchestrator as any).runHealthCheck('http://service', {
      path: '/health',
      timeout: 500,
      retries: 1,
    });

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(result).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
