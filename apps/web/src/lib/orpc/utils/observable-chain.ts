import {
  type DirectObservable,
  observableEventIteratorLink,
} from "../links/observable-event-iterator-link";

type AwaitedValue<T> = T extends Promise<infer U> ? AwaitedValue<U> : T;

type StreamItem<T> = T extends AsyncIterable<infer U>
  ? U
  : T extends DirectObservable<infer U>
    ? U
    : T;

type ObservableValueFromCall<TResult> = StreamItem<AwaitedValue<TResult>>;

type ObservableMethod<TInput, TResult> = (input: TInput) => DirectObservable<ObservableValueFromCall<TResult>>;

interface ProcedureWithCall {
  call: (input: unknown) => unknown;
}

type TanstackObservableAliases<T> =
  (T extends { experimental_liveOptions: infer TLiveOptions }
    ? { experimental_observableOptions: TLiveOptions }
    : {}) &
  (T extends { experimental_liveKey: infer TLiveKey }
    ? {
      experimental_observablekey: TLiveKey;
    }
    : {}) &
  (T extends { experimental_streamedOptions: infer TStreamedOptions }
    ? { experimental_streamedObservableOptions: TStreamedOptions }
    : {}) &
  (T extends { experimental_streamedKey: infer TStreamedKey }
    ? { experimental_streamedObservableKey: TStreamedKey }
    : {});

export type OrpcWithObservableChain<T> = T extends {
  call: (input: infer TInput) => infer TResult;
}
  ? T & { observable: ObservableMethod<TInput, TResult> } & TanstackObservableAliases<T>
  : T extends object
    ? { [K in keyof T]: OrpcWithObservableChain<T[K]> }
    : T;

function isDirectObservable(value: unknown): value is DirectObservable<unknown> {
  return typeof value === "object" && value !== null && "subscribe" in value && typeof (value as { subscribe?: unknown }).subscribe === "function";
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === "object" && value !== null && Symbol.asyncIterator in value;
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function isProcedureWithCall(value: unknown): value is ProcedureWithCall {
  return (
    isObjectLike(value) &&
    "call" in value &&
    typeof (value as { call?: unknown }).call === "function"
  );
}

function getAliasedMethod(
  target: object,
  sourceName: string,
): ((...args: unknown[]) => unknown) | undefined {
  if (!(sourceName in target)) {
    return undefined;
  }

  const source = (target as Record<string, unknown>)[sourceName];
  if (typeof source !== "function") {
    return undefined;
  }

  return (...args: unknown[]) => source.apply(target, args);
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

    const proxy = new Proxy(node, {
      get(target, prop, receiver) {
        if (prop === "experimental_observableOptions" && isProcedureWithCall(target)) {
          return getAliasedMethod(target, "experimental_liveOptions");
        }

        if (prop === "experimental_observablekey" && isProcedureWithCall(target)) {
          return getAliasedMethod(target, "experimental_liveKey");
        }

        if (prop === "experimental_streamedObservableOptions" && isProcedureWithCall(target)) {
          return getAliasedMethod(target, "experimental_streamedOptions");
        }

        if (prop === "experimental_streamedObservableKey" && isProcedureWithCall(target)) {
          return getAliasedMethod(target, "experimental_streamedKey");
        }

        if (prop === "observable" && isProcedureWithCall(target)) {
          return (input: unknown) =>
            observableEventIteratorLink.stream({
              input,
              call: async (callInput) => {
                const result = await target.call(callInput);
                if (isDirectObservable(result) || isAsyncIterable(result)) {
                  return result;
                }

                return {
                  subscribe(observer) {
                    observer.next?.(result);
                    observer.complete?.();
                    return {
                      unsubscribe() {
                        return undefined;
                      },
                    };
                  },
                };
              },
            });
        }

        const value = Reflect.get(target, prop, receiver);
        return isObjectLike(value) ? wrap(value) : value;
      },
    });

    cache.set(node, proxy);
    return proxy as TNode;
  };

  return wrap(orpc) as OrpcWithObservableChain<T>;
}
