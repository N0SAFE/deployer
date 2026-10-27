import type { Context } from "@orpc/server";
import type {
  StandardHandlerOptions,
  StandardHandlerPlugin,
} from "@orpc/server/standard";
import { isObservable } from "rxjs";
import { observableToAsyncIterator } from "./observable-to-async-iterator";

/**
 * Native RxJS transport: converts an `Observable` handler output into an
 * `AsyncIteratorObject` at the last moment before the codec encodes it, so the
 * existing SSE serialization (and its event metadata) is used unchanged.
 *
 * Controllers return Observables; this plugin is the only place the boundary is
 * crossed. Non-Observable outputs pass through untouched.
 */
export class RxJSHandlerPlugin<T extends Context> implements StandardHandlerPlugin<T> {
  readonly name = "rxjs";

  init(options: StandardHandlerOptions<T>): StandardHandlerOptions<T> {
    return {
      ...options,
      clientInterceptors: [
        async ({ next }) => {
          const output = await next();
          return isObservable(output) ? observableToAsyncIterator(output) : output;
        },
        ...(options.clientInterceptors ?? []),
      ],
    };
  }
}
