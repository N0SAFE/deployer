import { Context } from "effect";
import { Observable, ReplaySubject, type Subscription } from "rxjs";

type StreamPoolEntry<T> = {
  subject: ReplaySubject<T>;
  upstreamSubscription: Subscription;
  subscriberCount: number;
}

export type ObservePooledStreamOptions = {
  bufferSize?: number;
  onError?: (error: unknown) => string;
}

export type CoreEventStreamPoolServiceShape = {
  /**
   * One upstream per key, shared by every subscriber: the last `bufferSize` values replay to a late subscriber, and the
   * upstream is released when the last subscriber leaves. (A streaming surface: RxJS stays the contract.)
   */
  readonly observePooledStream: <T>(
    streamKey: string,
    streamFactory: () => Observable<T>,
    options?: ObservePooledStreamOptions,
  ) => Observable<T>;
};

const defaultErrorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function makeCoreEventStreamPoolService(
  log: { readonly warn: (message: string) => void } = { warn: (message) => { console.warn(message); } },
): CoreEventStreamPoolServiceShape {
  const streamPool = new Map<string, StreamPoolEntry<unknown>>();

  const getOrCreateEntry = <T>(
    streamKey: string,
    streamFactory: () => Observable<T>,
    options?: ObservePooledStreamOptions,
  ): StreamPoolEntry<T> => {
    const existing = streamPool.get(streamKey);
    if (existing) return existing as StreamPoolEntry<T>;

    const subject = new ReplaySubject<T>(Math.max(1, options?.bufferSize ?? 1));
    const upstreamSubscription = streamFactory().subscribe({
      next: (value) => {
        subject.next(value);
      },
      error: (error) => {
        const message = options?.onError ? options.onError(error) : defaultErrorMessage(error);
        log.warn(`Pooled stream '${streamKey}' failed: ${message}`);
        subject.error(error);
        streamPool.delete(streamKey);
      },
      complete: () => {
        subject.complete();
        streamPool.delete(streamKey);
      },
    });

    const createdEntry: StreamPoolEntry<T> = { subject, upstreamSubscription, subscriberCount: 0 };
    streamPool.set(streamKey, createdEntry as StreamPoolEntry<unknown>);
    return createdEntry;
  };

  const releaseEntry = (streamKey: string): void => {
    const entry = streamPool.get(streamKey);
    if (!entry) return;

    entry.subscriberCount = Math.max(0, entry.subscriberCount - 1);
    if (entry.subscriberCount > 0) return;

    entry.upstreamSubscription.unsubscribe();
    entry.subject.complete();
    streamPool.delete(streamKey);
  };

  return {
    observePooledStream: <T>(streamKey: string, streamFactory: () => Observable<T>, options?: ObservePooledStreamOptions) =>
      new Observable<T>((subscriber) => {
        const entry = getOrCreateEntry(streamKey, streamFactory, options);
        entry.subscriberCount += 1;

        const downstreamSubscription = entry.subject.subscribe(subscriber);

        return () => {
          downstreamSubscription.unsubscribe();
          releaseEntry(streamKey);
        };
      }),
  };
}

export class CoreEventStreamPoolService extends Context.Service<CoreEventStreamPoolService, CoreEventStreamPoolServiceShape>()(
  "shared/CoreEventStreamPoolService",
) {}
