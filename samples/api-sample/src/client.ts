import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { contract } from "./contracts";
import { createRxJSClient, collectClientPaths, type RxJSClient } from "./orpc/rxjs-client";

export interface ClientOptions {
  url: string;
  /** Forward cookies when calling from the browser/server on behalf of a user. */
  cookie?: string;
}

export type AppClient = RxJSClient<ContractRouterClient<typeof contract>>;

const clientPaths = collectClientPaths(contract);

/**
 * The server speaks the OpenAPI protocol (that is what `@orpc/nest` serves),
 * so the matching link is `OpenAPILink` — not `RPCLink`.
 *
 * `createRxJSClient` applies the client half of the RxJS transport: streamed
 * procedures are exposed as cold `Observable<T>` (typed by the contract) and
 * the decoded SSE iterator is converted on subscribe.
 */
export function createClient({ url, cookie }: ClientOptions): AppClient {
  const client = createORPCClient<ContractRouterClient<typeof contract>>(
    new OpenAPILink(contract, {
      origin: url,
      headers: () => (cookie ? { cookie } : {}),
    }),
  );

  return createRxJSClient(client, clientPaths);
}
