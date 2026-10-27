import { createHTTPUtils } from "@orpc/msw";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { contract } from "./contracts";
import { RxJSHandlerPlugin } from "./orpc/rxjs-handler.plugin";

/**
 * MSW mocks are derived from the contract and served by a *real*
 * `OpenAPIHandler` (with the same RxJS plugin as production), so validation,
 * serialization, error envelopes and SSE behave exactly like the server.
 */
export const mock = createHTTPUtils(contract, {
  prefix: "/",
  handler: (router) =>
    new OpenAPIHandler(router, {
      plugins: [new RxJSHandlerPlugin()],
    }),
});
