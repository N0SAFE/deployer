import { Injectable, Logger } from "@nestjs/common";
import { Observable, ReplaySubject, Subscription } from "rxjs";

interface StreamPoolEntry<T> {
  subject: ReplaySubject<T>;
  upstreamSubscription: Subscription;
  subscriberCount: number;
}

export interface ObservePooledStreamOptions {
  bufferSize?: number;
  onError?: (error: unknown) => string;
}

@Injectable()
export class CoreEventStreamPoolService {
  private readonly logger = new Logger(CoreEventStreamPoolService.name);
  private readonly streamPool = new Map<string, StreamPoolEntry<unknown>>();

  observePooledStream<T>(
    streamKey: string,
    streamFactory: () => Observable<T>,
    options?: ObservePooledStreamOptions,
  ): Observable<T> {
    return new Observable<T>((subscriber) => {
      const entry = this.getOrCreateEntry(streamKey, streamFactory, options);
      entry.subscriberCount += 1;

      const downstreamSubscription = entry.subject.subscribe(subscriber);

      return () => {
        downstreamSubscription.unsubscribe();
        this.releaseEntry(streamKey);
      };
    });
  }

  private getOrCreateEntry<T>(
    streamKey: string,
    streamFactory: () => Observable<T>,
    options?: ObservePooledStreamOptions,
  ): StreamPoolEntry<T> {
    const existing = this.streamPool.get(streamKey);
    if (existing) {
      return existing as StreamPoolEntry<T>;
    }

    const subject = new ReplaySubject<T>(Math.max(1, options?.bufferSize ?? 1));
    const upstreamSubscription = streamFactory().subscribe({
      next: (value) => {
        subject.next(value);
      },
      error: (error) => {
        const message = options?.onError
          ? options.onError(error)
          : this.defaultErrorMessage(error);
        this.logger.warn(`Pooled stream '${streamKey}' failed: ${message}`);
        subject.error(error);
        this.streamPool.delete(streamKey);
      },
      complete: () => {
        subject.complete();
        this.streamPool.delete(streamKey);
      },
    });

    const createdEntry: StreamPoolEntry<T> = {
      subject,
      upstreamSubscription,
      subscriberCount: 0,
    };

    this.streamPool.set(streamKey, createdEntry as StreamPoolEntry<unknown>);

    return createdEntry;
  }

  private releaseEntry(streamKey: string): void {
    const entry = this.streamPool.get(streamKey);
    if (!entry) {
      return;
    }

    entry.subscriberCount = Math.max(0, entry.subscriberCount - 1);
    if (entry.subscriberCount > 0) {
      return;
    }

    entry.upstreamSubscription.unsubscribe();
    entry.subject.complete();
    this.streamPool.delete(streamKey);
  }

  private defaultErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }
}