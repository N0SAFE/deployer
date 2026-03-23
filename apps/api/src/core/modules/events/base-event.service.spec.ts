import { describe, expect, it } from 'vitest';
import * as z from 'zod';
import { BaseEventService } from './base-event.service';
import { contractBuilder } from './event-contract.builder';

const testContracts = {
  changed: contractBuilder()
    .input(z.object({ id: z.string() }))
    .output(z.object({ value: z.string() }))
    .build(),
} as const;

class TestEventService extends BaseEventService<typeof testContracts> {
  constructor() {
    super('test', testContracts);
  }
}

describe('BaseEventService (RxJS internals)', () => {
  it('should emit to async iterable subscription', async () => {
    const service = new TestEventService();
    const subscription = service.subscribe('changed', { id: 'abc' });

    const pending = subscription.next();
    service.emit('changed', { id: 'abc' }, { value: 'hello' });

    await expect(pending).resolves.toEqual({ value: { value: 'hello' }, done: false });
    await subscription.return?.();
  });

  it('should track subscriber count and cleanup on return', async () => {
    const service = new TestEventService();

    const subscription = service.subscribe('changed', { id: 'abc' });
    expect(service.getSubscriberCount('changed', { id: 'abc' })).toBe(1);
    expect(service.hasSubscribers('changed', { id: 'abc' })).toBe(true);

    await subscription.return?.();

    expect(service.getSubscriberCount('changed', { id: 'abc' })).toBe(0);
    expect(service.hasSubscribers('changed', { id: 'abc' })).toBe(false);
  });

  it('should complete subscription when removeAllSubscribers is called', async () => {
    const service = new TestEventService();

    const subscription = service.subscribe('changed', { id: 'abc' });
    const pending = subscription.next();

    service.removeAllSubscribers('changed', { id: 'abc' });

    await expect(pending).resolves.toEqual({ value: undefined, done: true });
  });

  it('should clear all active events', async () => {
    const service = new TestEventService();

    const subA = service.subscribe('changed', { id: 'a' });
    const subB = service.subscribe('changed', { id: 'b' });

    expect(service.getActiveEvents()).toHaveLength(2);

    service.clearAll();

    expect(service.getActiveEvents()).toHaveLength(0);

    await subA.return?.();
    await subB.return?.();
  });

  it('should replay and filter events using queryByInput$ fuzzy search', async () => {
    const service = new TestEventService();

    service.emit('changed', { id: 'abc' }, { value: 'first' });
    service.emit('changed', { id: 'def' }, { value: 'second' });

    const received: Array<{ input: { id: string }; output: { value: string } }> = [];
    const subscription = service
      .queryByInput$('changed', {
        includePersisted: false,
        fuzzy: 'abc',
        replayLimit: 20,
      })
      .subscribe((event) => {
        received.push(event as { input: { id: string }; output: { value: string } });
      });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(received).toEqual([
      {
        input: { id: 'abc' },
        output: { value: 'first' },
      },
    ]);

    subscription.unsubscribe();
  });
});
