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
import { OpenAPILink } from "@orpc/openapi/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { appContract, type AppContract } from "./app-contract";
import { createObservableQueryUtils, type ObservableQueryUtils, ObservableLinkPlugin } from "@deployer/orpc-utils";
import { fetchWithTimeout } from "@deployer/orpc-utils/client/fetch-with-timeout";
import type { ContractRouterClient } from "@orpc/contract";

export type ViewsORPCClient = ContractRouterClient<AppContract>;

/** The API serves the views AND the ORPC endpoints on one origin, so the
 *  origin is the page's own origin and the base path stays `/`. */
export const orpcClient = createORPCClient<ViewsORPCClient>(
  new OpenAPILink(appContract, {
    // v2: `url` is the base PATH (matches the handler mount path), `origin`
    // is scheme+host. Server-side there is no origin to prepend.
    origin: typeof window === "undefined" ? undefined : window.location.origin,
    // ── BOUNDED, BECAUSE AN INGRESS SWAP LEAVES SOCKETS OPEN ──────────────
    // During the handover the entry port changes owner and this app exits. A
    // request in flight at that moment is neither answered nor closed, so a bare
    // `fetch` leaves TanStack Query in `pending` forever and the wizard's final
    // screen waits on a promise nothing will settle — the "stuck on the last
    // screen" report. The wrapper imposes a deadline and EXEMPTS the SSE stream,
    // which is supposed to stay open and has its own inactivity rule.
    fetch: fetchWithTimeout((request, init) => fetch(request, { ...init, credentials: "include" })),
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