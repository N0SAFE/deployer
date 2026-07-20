import type { Observable } from "rxjs";
import { BaseEventService } from "@/core/modules/events/base-event.service";
import {
  type EventContracts,
  type EventInput,
  type EventOutput,
} from "@/core/modules/events/event-contract.builder";
import type { CoreEventStreamPoolService } from "./core-event-stream-pool.service";
import { isRecord } from "@repo/type-guards"

export interface PooledEventObserveOptions {
  replayLimit?: number;
  includePersisted?: boolean;
  afterSequence?: number;
  pool?: boolean;
  bufferSize?: number;
}

export abstract class BasePooledEventService<
  TContracts extends EventContracts = EventContracts,
  TNamespace extends string = string,
> extends BaseEventService<TContracts, TNamespace> {
  constructor(
    eventPrefix: TNamespace,
    contracts: TContracts,
    private readonly streamPool?: CoreEventStreamPoolService,
  ) {
    super(eventPrefix, contracts);
  }

  protected observePooledEvent$<K extends keyof TContracts>(
    eventName: K,
    input: EventInput<TContracts[K]>,
    options?: PooledEventObserveOptions,
  ): Observable<EventOutput<TContracts[K]>> {


const replayLimit = options?.replayLimit;
    const includePersisted = options?.includePersisted ?? true;
    const afterSequence = options?.afterSequence;

    const createSource = () =>
      super.subscribe$(eventName, input, {
        replayLimit,
        includePersisted,
        afterSequence,
      });

    const shouldPool = options?.pool ?? (!includePersisted && afterSequence == null);

    if (!shouldPool || !this.streamPool) {
      return createSource();
    }

    const streamKey = this.buildPooledStreamKey({
      eventName: String(eventName),
      input,
      replayLimit,
      includePersisted,
      afterSequence,
    });

    return this.streamPool.observePooledStream(streamKey, createSource, {
      bufferSize: options?.bufferSize,
      onError: (error) => (error instanceof Error ? error.message : String(error)),
    });
  }

  private buildPooledStreamKey(input: {
    eventName: string;
    input: Record<string, unknown>;
    replayLimit?: number;
    includePersisted: boolean;
    afterSequence?: number;
  }): string {
    const stableInput = this.stableSerialize(input.input);

    return [
      "event-service",
      this.namespace,
      input.eventName,
      `input:${stableInput}`,
      `replay:${input.includePersisted ? "1" : "0"}`,
      `limit:${String(input.replayLimit ?? "")}`,
      `after:${String(input.afterSequence ?? "")}`,
    ].join("|");
  }

  private stableSerialize(value: unknown): string {
    return JSON.stringify(this.toStableValue(value));
  }

  private toStableValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.toStableValue(item));
    }

    if (isRecord(value)) {
      return Object.fromEntries(
        Object.entries(value)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, nested]) => [key, this.toStableValue(nested)]),
      );
    }

    return value;
  }
}