import { createORPCClient } from "@orpc/client";
import type { ClientContext } from "@orpc/client";
import { type AppContract, appContract } from "./app-contract";
import { RouterContractClient } from "@orpc/contract";import { validateEnvPath } from "#/env";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createObservableQueryUtils, type ObservableQueryUtils } from "@repo/orpc-utils";
import { ContextPlugin } from "./plugins/context-plugin";
import { MasterTokenPlugin } from "./plugins/masterTokenClient";
import { CookieHeadersPlugin } from "./plugins/cookie-headers-plugin";
import { RedirectOnUnauthorizedPlugin } from "./plugins/redirect-on-unauthorized-plugin";
import { AppInstancePlugin } from "./plugins/app-instance-plugin";
import { StandardLinkPlugin } from "@orpc/client/standard";
import { RequestCompressionLinkPlugin } from "@orpc/client/plugins";
import { ObservableLinkPlugin } from "@repo/orpc-utils";
import { FileUploadOpenAPILink } from "./links/file-upload-link";
import { addCacheOperations } from "@/domains/shared/cache-operations";

const Plugins = [
  // ── Transport: request compression ───────────────────────────────────
  //
  // Symmetric with the API's RequestCompressionHandlerPlugin; both default to a
  // 1 KB threshold so small payloads are never inflated by compression overhead.
  //
  // Response compression is deliberately NOT added on the client: the fetch
  // adapter already negotiates Accept-Encoding and transparently decompresses, so
  // a ResponseCompressionLinkPlugin here would double-decompress.
  //
  // BatchLinkPlugin is deliberately NOT added: `@orpc/nest` instantiates one
  // StandardHandler per controller procedure whose resolver is hardcoded to that
  // procedure, so a batch spanning several procedures silently executes one of
  // them repeatedly instead of routing each sub-request. Batching would be a
  // correctness hazard, not an optimisation.
  new RequestCompressionLinkPlugin({ encoding: "gzip" }),

  new CookieHeadersPlugin<PluginsContext>(),
  new MasterTokenPlugin<PluginsContext>(),
  new RedirectOnUnauthorizedPlugin<PluginsContext>(),
  new ContextPlugin<PluginsContext>(),
  new AppInstancePlugin<PluginsContext>(),
  new ObservableLinkPlugin<PluginsContext>(appContract),
];

/**
 * Context every plugin on this link may read.
 *
 * Declared explicitly (rather than inferred from the plugin array) because two
 * of these plugins have no inference site for their context generic — an empty
 * constructor leaves TypeScript with `unknown`, which then fails the
 * `ClientContext` constraint at the link and client call sites.
 */
export type PluginsContext = ClientContext & {
  cache?: RequestCache;
  next?: NextFetchRequestConfig;
  noRedirectOnUnauthorized?: boolean;
  cookie?: string | string[];
  headers?: Record<string, string | string[] | undefined>;
};

type ORPCClient = RouterContractClient<AppContract, PluginsContext>;

export function createORPCClientWithCookies(): ORPCClient {
  // Use FileUploadOpenAPILink instead of OpenAPILink to handle file uploads with progress
  const link = new FileUploadOpenAPILink<PluginsContext>(appContract, {
    // Use direct API URLs, bypassing Next.js proxy
    // Server: API_URL (private Docker network endpoint)
    // Browser: NEXT_PUBLIC_API_URL (public endpoint)
    //
    // oRPC v2 split the v1 `url` into `origin` (the base URL, prepended to every
    // request) plus `url` (a path-only prefix, defaulting to "/"). The full
    // origin therefore belongs in `origin`; passing it as `url` now fails the
    // codec's `/${string}` check.
    origin:
      typeof window === "undefined"
        ? validateEnvPath(process.env.API_URL ?? "", "API_URL")
        : validateEnvPath(
            process.env.NEXT_PUBLIC_API_URL ?? "",
            "NEXT_PUBLIC_API_URL",
          ),
    fetch(url, init, options, path) {
      return fetch(url, {
        ...init,
        credentials: "include",
        cache: options.context.cache,
        next: options.context.next ?? {
          revalidate: 60, // Revalidation toutes les 60 secondes
        },
      });
    },
    plugins: Plugins,
  });

  const client = createORPCClient<RouterContractClient<AppContract, PluginsContext>>(link);

  return client;
}

// Create TanStack Query utils directly from the client
// File upload progress tracking is now handled at the Link level (FileUploadOpenAPILink)
// This is the correct ORPC architecture pattern
// The WithFileUploadsClient type transformation ensures onProgress is available in context
const client = createORPCClientWithCookies();

const baseOrpc = createTanstackQueryUtils(client);

type EnhancedOrpc = ReturnType<typeof addCacheOperations<typeof baseOrpc>>;
type OrpcClient = ObservableQueryUtils<EnhancedOrpc>;

function createOrpcInternal(): OrpcClient {
  return createObservableQueryUtils(addCacheOperations(baseOrpc));
}

// Enhance with cache operations for type-safe cache manipulation
// This adds .cache property to all query endpoints with get/set/update/invalidate/remove methods
export const orpc: OrpcClient = createOrpcInternal();

/**
 * Raw ORPC client (callable). Use this when you need to make a direct
 * call outside of `useQuery` / `useMutation` — e.g. inside a custom
 * `fetch` function for an SSE-driven in-memory store.
 *
 * For React components, prefer the `orpc` TanStack utils + `useQuery`.
 */
export const orpcClient = client;

// Export appContract for type checking and testing
export { appContract };

export type Context = PluginsContext;
