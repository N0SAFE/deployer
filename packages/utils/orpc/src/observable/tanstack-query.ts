import type { Client, ClientContext, NestedClient } from "@orpc/client";
import {
  createTanstackQueryUtils,
  type RouterUtilsOptions,
  type RouterUtils,
} from "@orpc/tanstack-query";
import type { QueryFunctionContext, QueryKey, UseQueryOptions } from "@tanstack/react-query";
import { Observable as RxjsObservable } from "rxjs";
import type { Observable as RxObservable } from "rxjs";
import { reconstructObservableFromEventIterator } from "@repo/orpc-utils/observable/event-iterator";
import { isObjectLike } from "@repo/type-guards"

export type ObservableQueryMode = "observable" | "streamed-observable";

type InputOption<TInput> = undefined extends TInput
  ? { input?: TInput }
  : { input: TInput };

type ContextOption<TContext> = object extends TContext
  ? { context?: TContext }
  : { context: TContext };

type RuntimeProcedureWithCall = {
  call: (...args: unknown[]) => unknown;
};

type TanstackProcedureUtilsLike = {
  call: unknown;
};

type ExtractProcedureInput<TProcedure> = TProcedure extends {
  call: Client<infer _TContext, infer TInput, infer _TOutput, infer _TError>;
}
  ? TInput
  : never;

type ExtractProcedureOutput<TProcedure> = TProcedure extends {
  call: Client<infer _TContext, infer _TInput, infer TOutput, infer _TError>;
}
  ? TOutput
  : never;

type ExtractProcedureContext<TProcedure> = TProcedure extends {
  call: Client<infer TContext, infer _TInput, infer _TOutput, infer _TError>;
}
  ? TContext
  : object;

type ExtractStreamValue<TOutput> = TOutput extends AsyncIterable<infer TChunk>
  ? TChunk
  : TOutput extends RxObservable<infer TChunk>
    ? TChunk
    : TOutput;

type ExtractProcedureStreamValue<TProcedure> = ExtractStreamValue<ExtractProcedureOutput<TProcedure>>;

type AliasKeyMethod<
  TProcedure,
  TMethodName extends "experimental_liveKey" | "experimental_streamedKey",
  TInput,
> = TProcedure extends Record<TMethodName, infer TMethod>
  ? TMethod
  : (options?: { input?: TInput; queryKey?: QueryKey }) => QueryKey;

/**
 * Transform a source RxJS observable produced by an ORPC stream/live endpoint.
 *
 * The function receives the source observable and must return the observable
 * that will actually be subscribed to. By default the source observable is
 * subscribed to as-is, which means the caller can apply any RxJS operator
 * (`filter`, `map`, `debounceTime`, `throttleTime`, `bufferTime`, ...) or wrap
 * the source in another observable (e.g. `timer(200).pipe(switchMap(() => source$))`).
 *
 * @example
 *   // Debounce bursts before triggering a queryFn update
 *   useQuery(orpc.docker.runtime.stream.experimental_liveObservableOptions({
 *     queryFnOptions: (obs) => obs.pipe(debounceTime(200)),
 *   }))
 *
 * @example
 *   // Wait 200ms before subscribing to the source stream
 *   useQuery(orpc.docker.container.stream.experimental_streamedObservableOptions({
 *     queryFnOptions: (obs) => timer(200).pipe(switchMap(() => obs)),
 *   }))
 */
export type ObservablePipeTransform<TValue> = (
  source$: RxObservable<TValue>,
) => RxObservable<TValue>;

export type LiveObservableOptionsConfig<
  TInput,
  TStreamValue,
  TError = Error,
  TContext = object,
> = InputOption<TInput> &
  ContextOption<TContext> & {
  queryKey?: QueryKey;
  queryFnOptions?: ObservablePipeTransform<TStreamValue>;
} & Omit<UseQueryOptions<TStreamValue, TError>, "queryKey" | "queryFn">;

export type StreamedObservableOptionsConfig<
  TInput,
  TStreamValue,
  TError = Error,
  TContext = object,
> = InputOption<TInput> &
  ContextOption<TContext> & {
  queryKey?: QueryKey;
  queryFnOptions?: ObservablePipeTransform<TStreamValue>;
  /**
   * Whether the values seen so far mean the stream's work is genuinely OVER.
   *
   * ── WHY A CALLER MUST SOMETIMES SAY ──────────────────────────────────────
   * A stream that is CUT (an ingress swap tears the connection down, say) ends
   * with a clean `complete()`, which is indistinguishable from "finished" from
   * the outside. Without this predicate the collector treats that as success,
   * TanStack records a successful query, and NOTHING retries — the operator sees
   * the view blank out and no request in the network tab, because none is made.
   *
   * Supplying it inverts that: an incomplete stream REJECTS, so the query's own
   * `retry` configuration fires and `queryFn` runs again — which is the only
   * place a new HTTP request can be issued.
   *
   * Omit it for streams where ending IS the completion (a finite list, a log
   * stream that closes when its subject exits).
   */
  isComplete?: (emitted: readonly TStreamValue[]) => boolean;
} & Omit<UseQueryOptions<TStreamValue[], TError>, "queryKey" | "queryFn">;

type LiveObservableQueryOptionsResult<TStreamValue, TError> = Omit<
  UseQueryOptions<TStreamValue, TError>,
  "queryKey" | "queryFn"
> & {
  queryKey: QueryKey;
  queryFn: (context: QueryFunctionContext) => Promise<TStreamValue>;
};

type StreamedObservableQueryOptionsResult<TStreamValue, TError> = Omit<
  UseQueryOptions<TStreamValue[], TError>,
  "queryKey" | "queryFn"
> & {
  queryKey: QueryKey;
  queryFn: (context: QueryFunctionContext) => Promise<TStreamValue[]>;
};

export type ObservableProcedureQueryUtils<
  TInput,
  TStreamValue,
  TContext = object,
> = {
  experimental_liveObservableOptions<TError = Error>(
    options: LiveObservableOptionsConfig<TInput, TStreamValue, TError, TContext>,
  ): LiveObservableQueryOptionsResult<TStreamValue, TError>;
  experimental_streamedObservableOptions<TError = Error>(
    options: StreamedObservableOptionsConfig<TInput, TStreamValue, TError, TContext>,
  ): StreamedObservableQueryOptionsResult<TStreamValue, TError>;
};

type ObservableRouterQueryUtils<TOrpc> = TOrpc extends TanstackProcedureUtilsLike
  ? TOrpc &
      ObservableProcedureQueryUtils<
        ExtractProcedureInput<TOrpc>,
        ExtractProcedureStreamValue<TOrpc>,
        ExtractProcedureContext<TOrpc>
      > & {
        experimental_liveObservableKey: AliasKeyMethod<
          TOrpc,
          "experimental_liveKey",
          ExtractProcedureInput<TOrpc>
        >;
        experimental_streamedObservableKey: AliasKeyMethod<
          TOrpc,
          "experimental_streamedKey",
          ExtractProcedureInput<TOrpc>
        >;
      }
  : TOrpc extends (...args: unknown[]) => unknown
    ? TOrpc
  : TOrpc extends object
    ? { [K in keyof TOrpc]: ObservableRouterQueryUtils<TOrpc[K]> }
    : TOrpc;

export type ObservableQueryUtils<TInputOrOrpc, TStreamValue = never> = [TStreamValue] extends [never]
  ? ObservableRouterQueryUtils<TInputOrOrpc>
  : ObservableProcedureQueryUtils<TInputOrOrpc, TStreamValue>;


function isProcedureWithCall(value: unknown): value is RuntimeProcedureWithCall {
  return isObjectLike(value) && "call" in value && typeof (value as { call?: unknown }).call === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isRxObservable(value: unknown): value is RxObservable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "subscribe" in value &&
    typeof (value as { subscribe?: unknown }).subscribe === "function"
  );
}

function getBoundMethod(target: object, methodName: string): ((...args: unknown[]) => unknown) | undefined {
  if (!(methodName in target)) {
    return undefined;
  }

  const source = (target as Record<string, unknown>)[methodName];
  if (typeof source !== "function") {
    return undefined;
  }

  const callable = source as (...args: unknown[]) => unknown;
  return (...args: unknown[]) => Reflect.apply(callable, target, args);
}

function isTanstackUtilsLike(value: unknown): value is object {
  return (
    isObjectLike(value) &&
    ("key" in value ||
      ("queryKey" in value && "queryOptions" in value) ||
      isProcedureWithCall(value))
  );
}

function applyPipeTransform<TValue>(source$: RxObservable<TValue>): RxObservable<TValue>;
function applyPipeTransform<TValue>(
  source$: RxObservable<TValue>,
  pipeTransform: ObservablePipeTransform<TValue>,
): RxObservable<TValue>;
function applyPipeTransform<TValue>(
  source$: RxObservable<TValue>,
  pipeTransform?: ObservablePipeTransform<TValue>,
): RxObservable<TValue> {
  if (!pipeTransform) {
    return source$;
  }

  return pipeTransform(source$);
}

function toObservable<TValue>(source: unknown): RxObservable<TValue> {
  if (isRxObservable(source)) {
    return source as RxObservable<TValue>;
  }

  if (isAsyncIterable(source)) {
    return reconstructObservableFromEventIterator(source) as RxObservable<TValue>;
  }

  return new RxjsObservable<TValue>((subscriber) => {
    subscriber.next(source as TValue);
    subscriber.complete();
  });
}

/**
 * A stable identity for one stream event, used to recognise a REPLAY.
 *
 * ── WHY IDENTITY IS NEEDED AT ALL ───────────────────────────────────────────
 * A reconnect re-sends events the client already has (that is the point — it is
 * how a client re-syncs). Applying them again is what caused the flash: the
 * setup pipeline's early frames include an all-`pending` snapshot, so replaying
 * them walked every already-finished step back to idle before re-running it.
 *
 * ── WHY `(kind, stepId, seq)` IS SAFE ───────────────────────────────────────
 * `seq` is monotonic WITHIN a producer, and the two producers of the setup
 * timeline own DISJOINT steps — setup reports the swarm/API/ingress steps, the
 * API reports provisioning. So the pair never collides across them, and a
 * genuinely new event always gets a value the client has not seen.
 *
 * A retry produces higher sequence numbers (the counter belongs to the service,
 * not to the run), so it is NOT mistaken for a replay.
 */
function eventIdentity(event: unknown): string | null {
  if (!isObjectLike(event)) return null;
  const record = event as { type?: unknown; stepId?: unknown; seq?: unknown };
  if (typeof record.seq !== "number") return null;
  const kind = typeof record.type === "string" ? record.type : "?";
  const stepId = typeof record.stepId === "string" ? record.stepId : "";
  return `${kind}:${stepId}:${String(record.seq)}`;
}

async function collectObservableValues<TValue>(
  context: QueryFunctionContext,
  source$: RxObservable<TValue>,
  isComplete?: (emitted: readonly TValue[]) => boolean,
): Promise<TValue[]> {
  return await new Promise<TValue[]>((resolve, reject) => {
    // ── ACCUMULATE ACROSS ATTEMPTS, DON'T RESTART ───────────────────────────
    // A reconnecting stream is a NEW stream, and on the server side it may even
    // be a DIFFERENT producer: the setup progress stream is served by the setup
    // app, and after the handover that same URL is owned by the API. The API
    // replays ITS OWN events, which do not include the steps setup emitted.
    //
    // So a retry that started from an empty list would REPLACE the operator's
    // steps with whatever the new producer happens to know — the "all steps are
    // gone, only the loading text" state. Seeding from what is already cached
    // means the timeline only ever GROWS, whichever process is answering.
    const existing = context.client.getQueryData<TValue[]>(context.queryKey);
    const values: TValue[] = Array.isArray(existing) ? [...existing] : [];

    // Every identity already applied, so a REPLAYED event is recognised and
    // skipped rather than re-applied. See `eventIdentity`.
    const seen = new Set<string>();
    for (const value of values) {
      const identity = eventIdentity(value);
      if (identity !== null) seen.add(identity);
    }

    const rejectWith = (reason: unknown) => {
      reject(reason instanceof Error ? reason : new Error("Unknown stream error"));
    };

    const onAbort = () => {
      subscription.unsubscribe();
      rejectWith(context.signal.reason);
    };

    // Seed only when there is nothing yet: the intent is "do not show values
    // from a PREVIOUS, unrelated stream", never "wipe the current timeline".
    if (!Array.isArray(existing)) {
      context.client.setQueryData(context.queryKey, []);
    }

    const subscription = source$.subscribe({
      next(value) {
        // ── THE LINE THAT MAKES A RECONNECT FEEL INSTANT ────────────────────
        // Dropping replayed events is what keeps a reconnect from re-running the
        // pipeline on screen: the client keeps the steps it already drew, and
        // only the events it genuinely MISSED are appended. No reset, no flash,
        // and no duplicated log lines.
        const identity = eventIdentity(value);
        if (identity !== null) {
          if (seen.has(identity)) return;
          seen.add(identity);
        }

        values.push(value);
        context.client.setQueryData(context.queryKey, [...values]);
      },
      error(error) {
        context.signal.removeEventListener("abort", onAbort);
        subscription.unsubscribe();
        rejectWith(error);
      },
      complete() {
        context.signal.removeEventListener("abort", onAbort);
        subscription.unsubscribe();

        // A CLEAN END IS NOT ALWAYS COMPLETION. See `isComplete` on the options:
        // rejecting here is what lets the caller's `retry` re-run `queryFn` and
        // issue a genuinely new request — the only layer that can.
        //
        // The predicate is asked about the WHOLE accumulated list, so a
        // reconnect that already saw the terminal event does not loop.
        if (isComplete !== undefined && !isComplete(values)) {
          rejectWith(new Error("Stream ended before the work completed"));
          return;
        }

        resolve(values);
      },
    });

    if (context.signal.aborted) {
      onAbort();
      return;
    }

    context.signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function consumeObservableLatestValue<TValue>(
  context: QueryFunctionContext,
  source$: RxObservable<TValue>,
): Promise<TValue> {
  return await new Promise<TValue>((resolve, reject) => {
    let hasValue = false;
    let latestValue!: TValue;

    const rejectWith = (reason: unknown) => {
      reject(reason instanceof Error ? reason : new Error("Unknown stream error"));
    };

    const onAbort = () => {
      subscription.unsubscribe();
      rejectWith(context.signal.reason);
    };

    const subscription = source$.subscribe({
      next(value) {
        hasValue = true;
        latestValue = value;
        context.client.setQueryData(context.queryKey, value);
      },
      error(error) {
        context.signal.removeEventListener("abort", onAbort);
        subscription.unsubscribe();
        rejectWith(error);
      },
      complete() {
        context.signal.removeEventListener("abort", onAbort);
        subscription.unsubscribe();

        if (!hasValue) {
          reject(new Error("Observable stream completed without emitting any value"));
          return;
        }

        resolve(latestValue);
      },
    });

    if (context.signal.aborted) {
      onAbort();
      return;
    }

    context.signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeQueryKey(baseKey: QueryKey, providedQueryKey?: QueryKey): QueryKey {
  return providedQueryKey ?? baseKey;
}

type ProcedureBaseQueryOptions = {
  queryKey?: QueryKey;
  queryFn?: (context: QueryFunctionContext) => Promise<unknown>;
  [key: string]: unknown;
};

function resolveBaseProcedureOptions(
  procedure: object,
  methodName: "experimental_liveOptions" | "experimental_streamedOptions",
  options: {
    input: unknown;
    queryKey?: QueryKey;
    context: unknown;
    queryOptions: Record<string, unknown>;
  },
): ProcedureBaseQueryOptions | null {
  const method = getBoundMethod(procedure, methodName);
  if (!method) {
    return null;
  }

  const baseOptionsInput: Record<string, unknown> = {
    ...options.queryOptions,
    input: options.input,
  };

  if (options.queryKey !== undefined) {
    baseOptionsInput.queryKey = options.queryKey;
  }

  if (options.context !== undefined) {
    baseOptionsInput.context = options.context;
  }

  const result = method(baseOptionsInput);
  return isObjectLike(result) ? (result) : null;
}

function resolveProcedureKey(
  procedure: object,
  preferredMethodName: "experimental_liveKey" | "experimental_streamedKey",
  mode: ObservableQueryMode,
  input: unknown,
  providedQueryKey?: QueryKey,
): QueryKey {
  if (providedQueryKey) {
    return providedQueryKey;
  }

  const preferredMethod = getBoundMethod(procedure, preferredMethodName);
  if (preferredMethod) {
    return (input === undefined ? preferredMethod() : preferredMethod({ input })) as QueryKey;
  }

  const keyMethod = getBoundMethod(procedure, "key");
  if (keyMethod) {
    const operationType = mode === "observable" ? "live" : "streamed";
    return (input === undefined
      ? keyMethod({ type: operationType })
      : keyMethod({ type: operationType, input })) as QueryKey;
  }

  const queryKeyMethod = getBoundMethod(procedure, "queryKey");
  if (queryKeyMethod) {
    return (input === undefined ? queryKeyMethod() : queryKeyMethod({ input })) as QueryKey;
  }

  return input === undefined ? [mode] : [mode, input];
}

async function callProcedure(
  procedure: RuntimeProcedureWithCall,
  input: unknown,
  signal: AbortSignal,
  context: unknown,
): Promise<unknown> {
  const callOptions = context === undefined
    ? { signal }
    : { signal, context };

  return await procedure.call(input, callOptions);
}

function enhanceObservableQueryUtils<TOrpc extends object>(orpc: TOrpc): ObservableRouterQueryUtils<TOrpc> {
  const cache = new WeakMap<object, object>();
  const injectedMethodCache = new WeakMap<object, Map<PropertyKey, unknown>>();

  const getInjectedMethod = (
    target: object,
    prop: PropertyKey,
    factory: () => unknown,
  ): unknown => {
    const byTarget = injectedMethodCache.get(target) ?? new Map<PropertyKey, unknown>();
    injectedMethodCache.set(target, byTarget);

    if (byTarget.has(prop)) {
      return byTarget.get(prop);
    }

    const next = factory();
    byTarget.set(prop, next);
    return next;
  };

  const wrap = <TNode>(node: TNode): TNode => {
    if (!isObjectLike(node)) {
      return node;
    }

    const existing = cache.get(node);
    if (existing) {
      return existing as TNode;
    }

    const proxy = new Proxy(node, {
      get(target, prop, receiver) {
        if (prop === "experimental_liveObservableKey" && isProcedureWithCall(target)) {
          return getInjectedMethod(target, prop, () => {
            return (options?: { input?: unknown; queryKey?: QueryKey }): QueryKey => {
              return resolveProcedureKey(
                target,
                "experimental_liveKey",
                "observable",
                options?.input,
                options?.queryKey,
              );
            };
          });
        }

        if (prop === "experimental_streamedObservableKey" && isProcedureWithCall(target)) {
          return getInjectedMethod(target, prop, () => {
            return (options?: { input?: unknown; queryKey?: QueryKey }): QueryKey => {
              return resolveProcedureKey(
                target,
                "experimental_streamedKey",
                "streamed-observable",
                options?.input,
                options?.queryKey,
              );
            };
          });
        }

        if (prop === "experimental_liveObservableOptions" && isProcedureWithCall(target)) {
          return getInjectedMethod(target, prop, () => {
            return <TError = Error>(
              options: LiveObservableOptionsConfig<unknown, unknown, TError, unknown>,
            ): LiveObservableQueryOptionsResult<unknown, TError> => {
              const { input, queryKey, queryFnOptions, context, ...rest } = options;
              const baseOptions = resolveBaseProcedureOptions(target, "experimental_liveOptions", {
                input,
                queryKey,
                context,
                queryOptions: rest,
              });
              const key = normalizeQueryKey(
                (baseOptions?.queryKey)
                  ?? resolveProcedureKey(target, "experimental_liveKey", "observable", input, queryKey),
                queryKey,
              );

              return {
                ...(baseOptions ?? {}),
                ...rest,
                queryKey: key,
                queryFn: async (queryContext) => {
                  const result = await callProcedure(target, input, queryContext.signal, context);
                  const source$ = toObservable<unknown>(result);
                  const transformed$ = queryFnOptions
                    ? applyPipeTransform(source$, queryFnOptions)
                    : source$;

                  return await consumeObservableLatestValue(queryContext, transformed$);
                },
              };
            };
          });
        }

        if (prop === "experimental_streamedObservableOptions" && isProcedureWithCall(target)) {
          return getInjectedMethod(target, prop, () => {
            return <TError = Error>(
              options: StreamedObservableOptionsConfig<unknown, unknown, TError, unknown>,
            ): StreamedObservableQueryOptionsResult<unknown, TError> => {
              const { input, queryKey, queryFnOptions, context, isComplete, ...rest } = options;
              const baseOptions = resolveBaseProcedureOptions(target, "experimental_streamedOptions", {
                input,
                queryKey,
                context,
                queryOptions: rest,
              });
              const key = normalizeQueryKey(
                (baseOptions?.queryKey)
                  ?? resolveProcedureKey(target, "experimental_streamedKey", "streamed-observable", input, queryKey),
                queryKey,
              );

              return {
                ...(baseOptions ?? {}),
                ...rest,
                queryKey: key,
                queryFn: async (queryContext: QueryFunctionContext) => {
                  const result = await callProcedure(target, input, queryContext.signal, context);
                  const source$ = toObservable<unknown>(result);
                  const transformed$ = queryFnOptions
                    ? applyPipeTransform(source$, queryFnOptions)
                    : source$;

                  return await collectObservableValues(queryContext, transformed$, isComplete);
                },
              };
            };
          });
        }

        const value = Reflect.get(target, prop, receiver);
        return isObjectLike(value) ? wrap(value) : value;
      },
    });

    cache.set(node, proxy);
    return proxy;
  };

  return wrap(orpc) as ObservableRouterQueryUtils<TOrpc>;
}

export function createObservableQueryUtils<TClient extends NestedClient<ClientContext>>(
  client: TClient,
  options?: RouterUtilsOptions<TClient>,
): ObservableRouterQueryUtils<RouterUtils<TClient>>;
export function createObservableQueryUtils<TOrpc extends object>(
  orpc: TOrpc,
): ObservableRouterQueryUtils<TOrpc>;
export function createObservableQueryUtils(
  orpcOrClient: object,
  options?: RouterUtilsOptions<NestedClient<ClientContext>>,
): ObservableRouterQueryUtils<object> {
  const baseUtils = options !== undefined || !isTanstackUtilsLike(orpcOrClient)
    ? createTanstackQueryUtils(orpcOrClient as NestedClient<ClientContext>, options)
    : orpcOrClient;

  return enhanceObservableQueryUtils(baseUtils);
}
