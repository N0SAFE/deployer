import { Cause, Effect, Exit } from "effect";

import {
  EgressDenied,
  HttpFailed,
  HttpTimeout,
  ResponseTooLarge,
  SafeHttp,
  TooManyRedirects,
  type EgressPolicy,
  type HttpReq,
  type HttpRes,
  type SafeHttpOptions,
} from "./safe-http";

/**
 * `SafeHttp` for code that is not written in Effect yet (the Promise-API Nest classes).
 *
 * The Effect layer is built once; `request` runs it at the edge and THROWS the tagged error
 * (`EgressDenied`, `HttpTimeout`, `ResponseTooLarge`, `TooManyRedirects`, `HttpFailed`), so a
 * caller can `instanceof`-check it or pass it to {@link publicEgressMessage}. It goes away
 * when those classes become Effect services and yield `SafeHttp` directly.
 */
export type SafeHttpClient = {
  readonly request: (req: HttpReq, policy: EgressPolicy) => Promise<HttpRes>;
};

export const makeSafeHttpClient = (options: SafeHttpOptions = {}): SafeHttpClient => {
  const layer = SafeHttp.layerWith(options);
  return {
    request: async (req, policy) => {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          return yield* (yield* SafeHttp).request(req, policy);
        }).pipe(Effect.provide(layer)),
      );
      if (Exit.isSuccess(exit)) return exit.value;
      const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
      if (failure !== undefined) throw failure.error;
      throw new Error(`egress request failed unexpectedly: ${Cause.pretty(exit.cause)}`);
    },
  };
};

/**
 * A message that is safe to return to a caller. A raw transport error ("ECONNREFUSED 10.0.0.5:5432",
 * the address a name resolved to) would turn a probe endpoint into an internal port scanner, so
 * callers get a category and the detail stays in the server log.
 */
export const publicEgressMessage = (error: unknown): string => {
  if (error instanceof EgressDenied) return "Target not allowed by the network policy";
  if (error instanceof HttpTimeout) return "Timed out";
  if (error instanceof TooManyRedirects) return "Redirect not followed";
  if (error instanceof ResponseTooLarge) return "Response too large";
  if (error instanceof HttpFailed) return "Connection failed";
  return "Connection failed";
};
