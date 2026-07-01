import { get } from "@orpc/shared";
import { isContractProcedure, getEventIteratorSchemaDetails } from "@orpc/contract";
import type { StandardLinkPlugin, StandardLinkOptions } from "@orpc/client/standard";
import type { ClientContext } from "@orpc/client";
import { OBSERVABLE_DETAILS_SYMBOL, toAsyncIteratorFromObservable, type Observable } from "../../observable/contract";
import { reconstructObservableFromEventIterator } from "../../observable/event-iterator";

/**
 * StandardLinkPlugin that reconciles Observable ↔ AsyncIterable at the transport boundary.
 *
 * For procedures whose contract schema is marked with `OBSERVABLE_DETAILS_SYMBOL`
 * (via the `observable()` helper), this plugin:
 *
 * - **Input**: Converts an RxJS Observable → AsyncIterable before the codec encode step,
 *   so the streaming transport (event-iterator / SSE) can iterate over emitted chunks.
 * - **Output**: Converts the decoded AsyncIterable → Observable after the codec decode step,
 *   so consumers receive the type-level `Observable` at runtime.
 *
 * For all other procedures (plain schemas, plain `eventIterator()` contracts, etc.)
 * the plugin is a transparent pass-through.
 *
 * @example
 * ```ts
 * const link = new OpenAPILink(contract, {
 *   plugins: [new ObservableLinkPlugin(contract)],
 * });
 * ```
 */

/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
export class ObservableLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  /**
   * Low order ensures this plugin runs before most other interceptors,
   * so downstream code already sees the correct Observable/AsyncIterable types.
   */
  public readonly order = -100;

  constructor(private readonly appContract: unknown) {}

  init(options: StandardLinkOptions<T>): void {
    options.interceptors ??= [];

    options.interceptors.push(
      async (interceptorOptions) => {
        const { path, input } = interceptorOptions;
        const next = interceptorOptions.next.bind(interceptorOptions)

        // 1. Look up the procedure in the contract via the call path
        const procedure = get(this.appContract, path);
        if (!procedure || !isContractProcedure(procedure)) {
          return next(interceptorOptions);
        }

        const procDef = procedure["~orpc"];

        // 2. Check if input schema is observable-marked
        //    (Only OBSERVABLE_DETAILS_SYMBOL matters here because the user
        //     passes an Observable — we do NOT also check getEventIteratorSchemaDetails
        //     since an event-iterator contract on the input side means the user
        //     already provides an AsyncIterable, not an Observable.)
        const inputSchema = procDef.inputSchema as
          | { "~standard"?: Record<PropertyKey, unknown> }
          | undefined;
        const inputIsObservable =
          inputSchema?.["~standard"]?.[OBSERVABLE_DETAILS_SYMBOL] !== undefined;

        // 3. Check if output schema is observable-marked
        //    We check both OBSERVABLE_DETAILS_SYMBOL and getEventIteratorSchemaDetails
        //    because either marking means the transport returns an AsyncIterable that
        //    must be surfaced as an Observable to the caller.
        const outputSchema = procDef.outputSchema as
          | { "~standard"?: Record<PropertyKey, unknown> }
          | undefined;
        const outputHasObservableSymbol =
          outputSchema?.["~standard"]?.[OBSERVABLE_DETAILS_SYMBOL] !== undefined;
        const outputHasEventIterator =
          getEventIteratorSchemaDetails(outputSchema as Parameters<typeof getEventIteratorSchemaDetails>[0]) !== undefined;
        const outputIsObservable =
          outputHasObservableSymbol || outputHasEventIterator;

        // 4. If neither input nor output needs conversion, pass through
        if (!inputIsObservable && !outputIsObservable) {
          return next(interceptorOptions);
        }

        // 5. INPUT: Convert Observable → AsyncIterable when the user passes an Observable
        if (
          inputIsObservable &&
          input !== null &&
          typeof input === "object" &&
          "subscribe" in (input as Record<string, unknown>)
        ) {
          interceptorOptions.input = toAsyncIteratorFromObservable(
            input as Observable<unknown>,
          );
        }

        // 6. Call next — runs codec.encode → sender.call → codec.decode
        const result = await next(interceptorOptions);

        // 7. OUTPUT: Convert AsyncIterable → Observable when the output schema is observable-marked
        if (
          outputIsObservable &&
          result !== null &&
          typeof result === "object" &&
          Symbol.asyncIterator in (result as AsyncIterable<unknown>)
        ) {
          return reconstructObservableFromEventIterator(
            result as AsyncIterable<unknown>,
          );
        }

        return result;
      },
    );
  }
}
