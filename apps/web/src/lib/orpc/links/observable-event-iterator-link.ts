type EventSerializer<TInput, TOutput> = (value: TInput) => TOutput;
type EventDeserializer<TInput, TOutput> = (value: TInput) => TOutput;

interface DirectObserver<TValue> {
  next(value: TValue): void;
  error(error: unknown): void;
  complete(): void;
}

interface DirectSubscription {
  unsubscribe(): void;
}

export interface DirectObservable<TValue> {
  subscribe(observer: Partial<DirectObserver<TValue>>): DirectSubscription;
}

type StreamSource<TValue> = DirectObservable<TValue> | AsyncIterable<TValue>;

function createDirectObservable<TValue>(
  producer: (observer: DirectObserver<TValue>) => (() => void) | undefined,
): DirectObservable<TValue> {
  return {
    subscribe(observer) {
      const maybeCleanup = producer({
        next: observer.next ?? (() => undefined),
        error: observer.error ?? (() => undefined),
        complete: observer.complete ?? (() => undefined),
      });
      const cleanup = maybeCleanup ?? (() => undefined);

      return {
        unsubscribe() {
          cleanup();
        },
      };
    },
  };
}

function mapObservable<TWire, TValue>(
  source$: DirectObservable<TWire>,
  deserialize: EventDeserializer<TWire, TValue>,
): DirectObservable<TValue> {
  return createDirectObservable<TValue>((observer) => {
    const subscription = source$.subscribe({
      next(value) {
        observer.next(deserialize(value));
      },
      error(error) {
        observer.error(error);
      },
      complete() {
        observer.complete();
      },
    });

    return () => {
      subscription.unsubscribe();
    };
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function fromAsyncIterable<TValue>(source: AsyncIterable<TValue>): DirectObservable<TValue> {
  return createDirectObservable<TValue>((observer) => {
    void (async () => {
      try {
        for await (const value of source) {
          observer.next(value);
        }
        observer.complete();
      } catch (error) {
        observer.error(error);
      }
    })();

    return () => undefined;
  });
}

function toAsyncIterable<TValue>(source$: DirectObservable<TValue>): AsyncIterable<TValue> {
  const queue: TValue[] = [];
  let completed = false;
  let pendingError: unknown = null;
  let wake: (() => void) | null = null;

  const subscription = source$.subscribe({
    next(value) {
      queue.push(value);
      if (wake) {
        wake();
        wake = null;
      }
    },
    error(error) {
      pendingError = error;
      if (wake) {
        wake();
        wake = null;
      }
    },
    complete() {
      completed = true;
      if (wake) {
        wake();
        wake = null;
      }
    },
  });

  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          while (queue.length === 0 && !completed && pendingError === null) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }

          if (pendingError !== null) {
            subscription.unsubscribe();
            throw pendingError instanceof Error ? pendingError : new Error("Observable stream error");
          }

          const value = queue.shift();
          if (value === undefined) {
            subscription.unsubscribe();
            return { value: undefined, done: true };
          }

          return { value, done: false };
        },
        return() {
          subscription.unsubscribe();
          return Promise.resolve({ value: undefined, done: true } as const);
        },
      };
    },
  };
}

function asObservableSource<TValue>(source: StreamSource<TValue>): DirectObservable<TValue> {
  return isAsyncIterable(source) ? fromAsyncIterable(source) : source;
}

interface StreamOptions<TWire, TValue> {
  deserialize?: EventDeserializer<TWire, TValue>;
}

interface DuplexOptions<TInput, TInputWire, TOutputWire, TOutput> {
  serializeInput?: EventSerializer<TInput, TInputWire>;
  deserializeOutput?: EventDeserializer<TOutputWire, TOutput>;
}

/**
 * Observable-first helper for ORPC streamed procedures.
 *
 * It keeps transport compatibility with EventIterator/AsyncIterable while exposing
 * a native observable interface to web domain hooks and UI layers.
 */
export class ObservableEventIteratorLink {
  stream<TInput, TWireOutput, TOutput = TWireOutput>(params: {
    input: TInput;
    call: (input: TInput) => StreamSource<TWireOutput> | Promise<StreamSource<TWireOutput>>;
    options?: StreamOptions<TWireOutput, TOutput>;
  }): DirectObservable<TOutput> {
    return createDirectObservable<TOutput>((observer) => {
      let innerSubscription: DirectSubscription | null = null;
      let cancelled = false;

      void Promise.resolve(params.call(params.input))
        .then((source) => {
          if (cancelled) {
            return;
          }

          const source$ = asObservableSource(source);
          innerSubscription = mapObservable(
            source$,
            params.options?.deserialize ?? ((value: TWireOutput) => value as unknown as TOutput),
          ).subscribe(observer);
        })
        .catch((error: unknown) => {
          observer.error(error);
        });

      return () => {
        cancelled = true;
        innerSubscription?.unsubscribe();
      };
    });
  }

  duplex<TInput, TInputWire = TInput, TOutputWire = unknown, TOutput = TOutputWire>(params: {
    input$: DirectObservable<TInput>;
    call: (
      input: AsyncIterable<unknown>,
    ) => StreamSource<TOutputWire> | Promise<StreamSource<TOutputWire>>;
    options?: DuplexOptions<TInput, TInputWire, TOutputWire, TOutput>;
  }): DirectObservable<TOutput> {
    const serializedInput$ = mapObservable(
      params.input$,
      params.options?.serializeInput ?? ((value: TInput) => value as unknown as TInputWire),
    ) as DirectObservable<unknown>;
    const serializedInputIterator = toAsyncIterable(serializedInput$);

    return createDirectObservable<TOutput>((observer) => {
      let innerSubscription: DirectSubscription | null = null;
      let cancelled = false;

      void Promise.resolve(params.call(serializedInputIterator))
        .then((outputSource) => {
          if (cancelled) {
            return;
          }

          const output$ = asObservableSource(outputSource);

          innerSubscription = mapObservable(
            output$,
            params.options?.deserializeOutput ?? ((value: TOutputWire) => value as unknown as TOutput),
          ).subscribe(observer);
        })
        .catch((error: unknown) => {
          observer.error(error);
        });

      return () => {
        cancelled = true;
        innerSubscription?.unsubscribe();
      };
    });
  }
}

export const observableEventIteratorLink = new ObservableEventIteratorLink();
