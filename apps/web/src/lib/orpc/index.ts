import { createORPCClient } from "@orpc/client";
import {
  type AppContract,
  appContract,
} from "@repo/api-contracts";
import { ContractRouterClient } from "@orpc/contract";
import { validateEnvPath } from "#/env";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { createObservableQueryUtils, type ObservableQueryUtils } from "@repo/orpc-utils";
import { ContextPlugin } from "./plugins/context-plugin";
import { MasterTokenPlugin } from "./plugins/masterTokenClient";
import { CookieHeadersPlugin } from "./plugins/cookie-headers-plugin";
import { RedirectOnUnauthorizedPlugin } from "./plugins/redirect-on-unauthorized-plugin";
import { StandardLinkPlugin } from "@orpc/client/standard";
import { ObservableLinkPlugin } from "@repo/orpc-utils";
import { FileUploadOpenAPILink } from "./links/file-upload-link";
import { addCacheOperations } from "@/domains/shared/cache-operations";

const Plugins = [
  new CookieHeadersPlugin(),
  new MasterTokenPlugin(),
  new RedirectOnUnauthorizedPlugin(),
  new ContextPlugin(),
  new ObservableLinkPlugin(appContract),
];

type PluginsContext = {
  [K in keyof typeof Plugins]: (typeof Plugins)[K] extends StandardLinkPlugin<
    infer C
  >
    ? C
    : never;
}[number] extends infer U
  ? (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void
    ? I
    : never
  : never;

type ORPCClient = ContractRouterClient<AppContract, PluginsContext>;

export function createORPCClientWithCookies(): ORPCClient {
  // Use FileUploadOpenAPILink instead of OpenAPILink to handle file uploads with progress
  const link = new FileUploadOpenAPILink<PluginsContext>(appContract, {
    // Use direct API URLs, bypassing Next.js proxy
    // Server: API_URL (private Docker network endpoint)
    // Browser: NEXT_PUBLIC_API_URL (public endpoint)
    url:
      typeof window === "undefined"
        ? validateEnvPath(process.env.API_URL ?? "", "API_URL")
        : validateEnvPath(
            process.env.NEXT_PUBLIC_API_URL ?? "",
            "NEXT_PUBLIC_API_URL",
          ),
    fetch(request, init, options) {
      return fetch(request, {
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

  const client = createORPCClient<ContractRouterClient<AppContract, PluginsContext>>(link);

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
