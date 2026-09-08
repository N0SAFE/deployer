import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { contractBuilder } from './event-contract.builder';
import { BaseEventService, type EventLogPersistenceAdapter } from './base-event.service';
import * as z from 'zod/v4';

const testContracts = {
  progress: contractBuilder()
    .input(z.object({ taskId: z.string() }))
    .output(z.object({ step: z.string(), seq: z.number() }))
    .build(),
};

// Subclass with a tiny flush batch so a single emit triggers a flush attempt
// on the NEXT emit crossing the threshold — we want to drive `flush` via emit.
class TinyBatchTestService extends BaseEventService<typeof testContracts, 'test'> {
  constructor() {
    super('test', testContracts);
  }
}

function setTinyBatch(svc: TinyBatchTestService): void {
  (svc as unknown as { pendingFlushBatchSize: number }).pendingFlushBatchSize = 2;
}

const emptyFind = () => Promise.resolve([]);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  BaseEventService.clearRegistryForTests();
});

describe('BaseEventService persistence retry', () => {
  it('does NOT drop a pending batch when insertMany fails; retries and drains on success', async () => {
    vi.useFakeTimers();

    const inserted: unknown[] = [];
    let callCount = 0;
    const adapter: EventLogPersistenceAdapter = {
      insertMany: vi.fn(async (logs) => {
        callCount += 1;
        if (callCount === 1) {
          throw new Error('relation "core_event_logs" does not exist');
        }
        inserted.push(...logs);
      }),
      findRecentByEventKey: emptyFind,
      findRecentByEventName: emptyFind,
    };
    BaseEventService.configurePersistenceAdapter(adapter);

    const svc = new TinyBatchTestService();
    setTinyBatch(svc);

    // Emit twice to cross the batch threshold (size 2) → triggers a flush that FAILS.
    svc.emit('progress', { taskId: 'a' }, { step: 'x', seq: 1 });
    svc.emit('progress', { taskId: 'a' }, { step: 'y', seq: 2 });

    // First attempt fails (retry scheduled). Advance the unref'd retry timer.
    await vi.advanceTimersByTimeAsync(2_000);

    // The retry must have succeeded and drained the batch; the batch was NOT dropped.
    expect(inserted.length).toBe(2);
    expect(adapter.insertMany).toHaveBeenCalledTimes(2);

    svc.onModuleDestroy();
    vi.useRealTimers();
  });

  it('keeps emitting-subscribers working even when persistence is down (audit is best-effort)', async () => {
    const adapter: EventLogPersistenceAdapter = {
      insertMany: vi.fn().mockRejectedValue(new Error('db down')),
      findRecentByEventKey: emptyFind,
      findRecentByEventName: emptyFind,
    };
    BaseEventService.configurePersistenceAdapter(adapter);

    const svc = new TinyBatchTestService();
    const received: string[] = [];
    const sub = svc.subscribe$('progress', { taskId: 'live' }).subscribe((e) => {
      received.push(e.step);
    });

    svc.emit('progress', { taskId: 'live' }, { step: 'a', seq: 1 });
    svc.emit('progress', { taskId: 'live' }, { step: 'b', seq: 2 });

    expect(received).toEqual(['a', 'b']);
    sub.unsubscribe();
    svc.onModuleDestroy();
  });
});
