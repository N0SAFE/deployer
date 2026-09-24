"use client";

/** ORPC client for the SSR views — same ORPC surface as the web app (the
 *  platform managed-web ops). The views call the API directly through the
 *  typed contract (React Query), never through HTTP form POSTs.
 *
 *  Server-side render: the console page receives its initial `state` as props
 *  from the @Render controller (SSR data) — React Query hydrates from that.
 *  Client-side: RQ re-fetches and mutations go through ORPC + invalidation.
 */

import { createORPCClient } from "@orpc/client";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { appContract, type AppContract } from "@repo/api-contracts";
import { createObservableQueryUtils, type ObservableQueryUtils, ObservableLinkPlugin } from "@repo/orpc-utils";
import type { ContractRouterClient } from "@orpc/contract";

export type ViewsORPCClient = ContractRouterClient<AppContract>;

/** Base URL: same origin as the page (the API serves the views AND the ORPC
 *  endpoints on one origin / gateway). */
export const orpcClient = createORPCClient<ViewsORPCClient>(
  new OpenAPILink(appContract, {
    url: typeof window === "undefined" ? "" : window.location.origin,
    fetch(request, init) {
      return fetch(request, { ...init, credentials: "include" });
    },
    // ObservableLinkPlugin is what makes the SSE progress stream usable from
    // TanStack Query (`experimental_streamedObservableOptions`). Without it the
    // setup wizard could not subscribe to its own provisioning events.
    plugins: [new ObservableLinkPlugin(appContract)],
  }),
);

/** TanStack Query utils (queryOptions / mutationOptions per op). */
const baseOrpc = createTanstackQueryUtils(orpcClient);

export const orpc: ObservableQueryUtils<typeof baseOrpc> =
  createObservableQueryUtils(baseOrpc);