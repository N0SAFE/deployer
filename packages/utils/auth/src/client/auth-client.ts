import { createAuthClient } from 'better-auth/react'
import type { BetterAuthClientOptions, BetterAuthClientPlugin } from 'better-auth/client'
import { inferAdditionalFields } from 'better-auth/client/plugins'
import type { betterAuthFactory, useAdmin } from '../server'
import {
    masterTokenClient,
    loginAsClientPlugin,
    useInviteClient,
    useAdminClient,
} from './plugins'

// Extract the actual auth type from the factory return type
type AuthInstance = ReturnType<typeof betterAuthFactory>['auth']

export type CreateAuthClientFactoryOptions = Pick<BetterAuthClientOptions, 'basePath' | 'baseURL' | 'fetchOptions'>

// The platform's client plugins, kept as a concrete array so Better Auth's
// type inference is never widened (an un-annotated `const x = []` in the
// plugins tuple widens to `any[]` and silently erases all plugin typing).
const DEFAULT_PLUGINS = [
  masterTokenClient(),
  loginAsClientPlugin(),
  useInviteClient(),
  useAdminClient(),
  inferAdditionalFields<AuthInstance>(),
]

// Server-side admin plugin types, carried into the client through better-auth's
// type-only `$InferAuth` marker. Without it, tsc cannot instantiate
// `adminClient()`'s `$InferServerPlugin` (its `endpoints`/`schema` exceed
// tsc's instantiation depth) and silently drops the admin RPC methods
// (listUsers, banUser, …). tsgo handles the types; tsc does not — this
// marker fixes the client for both engines.
// Only the ADMIN server plugin is carried here: including the invite /
// server plugins made their server-side endpoint types overwrite
// the client plugin methods (authClient.invite.* broke under TS2769).
// `$InferAuth` is purely type-level: it does not exist anywhere in
// better-auth's runtime, is never read, and is never sent to the server.
type ServerPlugins = ReturnType<typeof useAdmin>[]

interface InferredClientOptions {
  plugins: typeof DEFAULT_PLUGINS
  $InferAuth: { plugins: ServerPlugins }
}

/**
 * Factory function to create a Better Auth client with the platform's default
 * plugins (master token, login-as, invite, admin,
 * `inferAdditionalFields`) and the server-side admin plugin types wired
 * through `$InferAuth` so the admin RPC methods are typed under both tsc
 * and tsgo.
 *
 * NOTE: there is intentionally no `additionalPlugins` option. The last time it
 * existed, an un-annotated `const additionalPlugins = []` default widened to
 * `any[]`, erasing Better Auth's plugin type inference (session fields and the
 * admin RPC methods silently disappeared). When a future caller genuinely
 * needs extra plugins, pass the concrete tuple through a dedicated option.
 */
export const createAuthClientFactory = (options: CreateAuthClientFactoryOptions) => {
  const {
    basePath = '/api/auth',
    baseURL,
    fetchOptions = {
      credentials: 'include',
    },
  } = options

  const clientOptions = {
    basePath,
    baseURL,
    fetchOptions,
    plugins: DEFAULT_PLUGINS,
    // Type-only marker — the value is a placeholder; better-auth never reads
    // `$InferAuth` at runtime. Its TYPE carries the server admin plugin types.
    $InferAuth: {
      plugins: [],
    },
  } satisfies BetterAuthClientOptions

  return createAuthClient<InferredClientOptions>(clientOptions)
}
