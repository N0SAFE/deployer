import { defer, from, isObservable, mergeMap, throwError, type Observable } from "rxjs";
import { isAsyncIteratorObject } from "@orpc/shared";
import { isObservableSchema } from "../contracts/observable";
import { asyncIteratorToObservable } from "./async-iterator-to-observable";

/**
 * Type-level mapping: a streamed procedure (`Observable<T>` in the contract) is
 * exposed as a cold `Observable<T>` instead of a `Promise<Observable<T>>`.
 * Every other procedure keeps its original signature.
 */
export type RxJSClient<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => Promise<infer R>
    ? R extends Observable<infer U>
      ? (...args: A) => Observable<U>
      : T[K]
    : T[K] extends object
      ? RxJSClient<T[K]>
      : T[K];
};

export interface ClientPaths {
  readonly procedures: ReadonlySet<string>;
  readonly streams: ReadonlySet<string>;
}

interface ProcedureLike {
  readonly "~orpc"?: { readonly outputSchemas?: readonly unknown[] };
}

/** Walks the contract once: every procedure path, plus the ones returning Observables. */
export function collectClientPaths(
  router: object,
  path: string[] = [],
  paths: { procedures: Set<string>; streams: Set<string> } = {
    procedures: new Set(),
    streams: new Set(),
  },
): ClientPaths {
  for (const [key, value] of Object.entries(router)) {
    if (typeof value !== "object" || value === null) continue;

    const procedure = value as ProcedureLike;

    if (procedure["~orpc"] !== undefined) {
      const keyPath = [...path, key].join(".");
      paths.procedures.add(keyPath);

      const outputs = procedure["~orpc"].outputSchemas ?? [];
      if (outputs.some((schema) => isObservableSchema(schema))) {
        paths.streams.add(keyPath);
      }

      continue;
    }

    collectClientPaths(value, [...path, key], paths);
  }

  return paths;
}

/**
 * Runtime half of the mapping: streamed procedures return a cold Observable
 * that starts the HTTP call on subscribe and forwards its inner Observable.
 * Other procedures and nested clients are returned untouched.
 */
export function createRxJSClient<T extends object>(client: T, paths: ClientPaths): RxJSClient<T> {
  return wrap(client, [], paths) as RxJSClient<T>;
}

function wrap(target: object, path: string[], paths: ClientPaths): object {
  return new Proxy(target, {
    get(node, property) {
      const value = Reflect.get(node, property) as unknown;
      const propertyPath = [...path, String(property)];
      const key = propertyPath.join(".");

      if (typeof value === "function") {
        // Nested client: a callable proxy, must be wrapped to keep its path.
        if (!paths.procedures.has(key)) {
          return wrap(value, propertyPath, paths);
        }

        if (!paths.streams.has(key)) {
          return value;
        }

        const call = value as (...args: unknown[]) => Promise<unknown>;

        return streamCall(call, key);
      }

      if (typeof value === "object" && value !== null) {
        return wrap(value, propertyPath, paths);
      }

      return value;
    },
  });
}

/** Cold wrapper: the HTTP call starts on subscribe, then flattens the stream. */
function streamCall(call: (...args: unknown[]) => Promise<unknown>, key: string) {
  return (...args: unknown[]) =>
    defer(() => from(call(...args))).pipe(mergeMap((output) => toObservable(output, key)));
}

function toObservable(output: unknown, key: string): Observable<unknown> {
  if (isObservable(output)) return output;

  if (isAsyncIteratorObject(output)) {
    return asyncIteratorToObservable(output as AsyncIterator<unknown>);
  }

  return throwError(() => new Error(`Expected Observable from ${key}`));
}
