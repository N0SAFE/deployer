import { get } from "@orpc/shared";
import { isContractProcedure, getEventIteratorSchemaDetails } from "@orpc/contract";
import type { StandardLinkPlugin, StandardLinkOptions, StandardLinkInterceptorOptions } from "@orpc/client/standard";
import type { ClientContext } from "@orpc/client";
import { OBSERVABLE_DETAILS_SYMBOL, toAsyncIteratorFromObservable, type Observable } from "./contract";
import { reconstructObservableFromEventIterator } from "./event-iterator";

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
export class ObservableLinkPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  /**
   * Low order ensures this plugin runs before most other interceptors,
   * so downstream code already sees the correct Observable/AsyncIterable types.
   */
  public readonly order = -100;

  constructor(private readonly appContract: unknown) {}

  init(options: StandardLinkOptions<T>): void {
    const plugin = this;
    const existing = options.interceptors ?? [];

    options.interceptors = [
      ...existing,
      async (interceptorOptions: {
        readonly path: readonly string[];
        input: unknown;
        next: (options: StandardLinkInterceptorOptions<T>) => Promise<unknown>;
      } & Record<string, unknown>): Promise<unknown> => {
        const { path, input, next } = interceptorOptions;

        // 1. Look up the procedure in the contract via the call path
        const procedure = get(plugin.appContract, path);
        if (!procedure || !isContractProcedure(procedure)) {
          return next(interceptorOptions as unknown as StandardLinkInterceptorOptions<T>);
        }

        const procDef = (procedure as { "~orpc": { outputSchema?: unknown; inputSchema?: unknown } })["~orpc"];

        // 2. Check if input schema is observable-marked
        const inputSchema = procDef.inputSchema as
          | { "~standard"?: Record<PropertyKey, unknown> }
          | undefined;
        const inputIsObservable =
          inputSchema?.["~standard"]?.[OBSERVABLE_DETAILS_SYMBOL] !== undefined;

        // 3. Check if output schema is observable-marked
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
          return next(interceptorOptions as unknown as StandardLinkInterceptorOptions<T>);
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
        const result = await next(interceptorOptions as unknown as StandardLinkInterceptorOptions<T>);

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
    ];
  }
}
