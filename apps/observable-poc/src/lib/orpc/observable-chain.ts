import {
  reconstructObservableFromEventIterator,
  type DirectObservable,
} from "@repo/orpc-utils";
import type { ClientPromiseResult } from "@orpc/client";

export const OBSERVABLE_QUERY_PIPE_CONTEXT_SYMBOL = Symbol("observable-poc.query.pipe");
export const OBSERVABLE_CHAIN_PRESERVE_ASYNC_ITERATOR_SYMBOL = Symbol(
  "observable-poc.preserve-async-iterator",
);

type ObservablePipeTransform = (
  rxjsPipe: (...operators: unknown[]) => DirectObservable<unknown>,
) => DirectObservable<unknown>;

type NormalizeStreamOutput<T> = T extends AsyncIterable<infer U>
  ? DirectObservable<U>
  : T;

type NormalizeCallResult<T> = T extends ClientPromiseResult<infer U, infer E>
  ? ClientPromiseResult<NormalizeStreamOutput<U>, E>
  : T extends Promise<infer U>
    ? Promise<NormalizeStreamOutput<U>>
    : NormalizeStreamOutput<T>;

export type OrpcWithObservableChain<T> = T extends (...args: infer TArgs) => infer TResult
  ? (...args: TArgs) => NormalizeCallResult<TResult>
  : T extends object
    ? { [K in keyof T]: OrpcWithObservableChain<T[K]> }
    : T;

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isDirectObservable(value: unknown): value is DirectObservable<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "subscribe" in value &&
    typeof (value as { subscribe?: unknown }).subscribe === "function"
  );
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function normalizeThrownError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error("Unknown observable stream error");
}

function isTanstackStreamOperation(options: unknown): boolean {
  if (typeof options !== "object" || options === null || !("context" in options)) {
    return false;
  }

  const context = (options as { context?: unknown }).context;
  if (typeof context !== "object" || context === null) {
    return false;
  }

  for (const symbol of Object.getOwnPropertySymbols(context)) {
    const entry = (context as Record<symbol, unknown>)[symbol];
    if (typeof entry !== "object" || entry === null || !("type" in entry)) {
      continue;
    }

    const type = (entry as { type?: unknown }).type;
    if (type === "streamed" || type === "live") {
      return true;
    }
  }

  return false;
}

function getObservablePipeTransform(options: unknown): ObservablePipeTransform | undefined {
  if (typeof options !== "object" || options === null || !("context" in options)) {
    return undefined;
  }

  const context = (options as { context?: unknown }).context;
  if (typeof context !== "object" || context === null) {
    return undefined;
  }

  const candidate = (context as Record<PropertyKey, unknown>)[OBSERVABLE_QUERY_PIPE_CONTEXT_SYMBOL];
  return typeof candidate === "function" ? (candidate as ObservablePipeTransform) : undefined;
}

function shouldPreserveAsyncIteratorOutput(options: unknown): boolean {
  if (typeof options !== "object" || options === null || !("context" in options)) {
    return false;
  }

  const context = (options as { context?: unknown }).context;
  if (typeof context !== "object" || context === null) {
    return false;
  }

  return (context as Record<PropertyKey, unknown>)[OBSERVABLE_CHAIN_PRESERVE_ASYNC_ITERATOR_SYMBOL] === true;
}

function applyPipeTransform(
  source$: DirectObservable<unknown>,
  pipeTransform?: ObservablePipeTransform,
): DirectObservable<unknown> {
  if (!pipeTransform) {
    return source$;
  }

  const rxjsPipe = (...operators: unknown[]) =>
    source$.pipe(...(operators as Parameters<DirectObservable<unknown>["pipe"]>));

  return pipeTransform(rxjsPipe);
}

function toAsyncIteratorFromObservable<TValue>(source$: DirectObservable<TValue>): AsyncIterable<TValue> {
  return {
    [Symbol.asyncIterator]() {
      const queue: TValue[] = [];
      let done = false;
      let thrownError: unknown = null;
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
          thrownError = error;
          if (wake) {
            wake();
            wake = null;
          }
        },
        complete() {
          done = true;
          if (wake) {
            wake();
            wake = null;
          }
        },
      });

      return {
        async next() {
          while (queue.length === 0 && !done && thrownError === null) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }

          if (thrownError !== null) {
            subscription.unsubscribe();
            throw normalizeThrownError(thrownError);
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

function normalizeCallOutput<TOutput>(
  output: TOutput,
  preserveAsyncIteratorOutput: boolean,
  pipeTransform?: ObservablePipeTransform,
): NormalizeCallResult<TOutput> {
  const normalizeResolvedValue = (resolved: unknown): unknown => {
    if (!isDirectObservable(resolved) && !isAsyncIterable(resolved)) {
      return resolved;
    }

    if (isDirectObservable(resolved)) {
      const transformed$ = applyPipeTransform(resolved, pipeTransform);
      if (preserveAsyncIteratorOutput) {
        return toAsyncIteratorFromObservable(transformed$);
      }

      return transformed$;
    }

    if (preserveAsyncIteratorOutput && !pipeTransform) {
      return resolved;
    }

    const source$ = reconstructObservableFromEventIterator(resolved);
    const transformed$ = applyPipeTransform(source$, pipeTransform);

    return preserveAsyncIteratorOutput
      ? toAsyncIteratorFromObservable(transformed$)
      : transformed$;
  };

  if (isPromiseLike(output)) {
    return output.then((resolved) => normalizeResolvedValue(resolved)) as NormalizeCallResult<TOutput>;
  }

  return normalizeResolvedValue(output) as NormalizeCallResult<TOutput>;
}

export function withObservableChain<T extends object>(orpc: T): OrpcWithObservableChain<T> {
  const cache = new WeakMap<object, object>();

  const wrap = <TNode>(node: TNode): TNode => {
    if (!isObjectLike(node)) {
      return node;
    }

    const existing = cache.get(node);
    if (existing) {
      return existing as TNode;
    }

    const proxy = new Proxy(node as object, {
      apply(target, thisArg, argArray) {
        const output = Reflect.apply(target as (...args: unknown[]) => unknown, thisArg, argArray);
        const preserveAsyncIteratorOutput =
          isTanstackStreamOperation(argArray[1]) || shouldPreserveAsyncIteratorOutput(argArray[1]);
        const pipeTransform = getObservablePipeTransform(argArray[1]);

        return normalizeCallOutput(output, preserveAsyncIteratorOutput, pipeTransform);
      },
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver) as unknown;
        return isObjectLike(value) ? wrap(value) : value;
      },
    });

    cache.set(node, proxy);
    return proxy as TNode;
  };

  return wrap(orpc) as OrpcWithObservableChain<T>;
}
