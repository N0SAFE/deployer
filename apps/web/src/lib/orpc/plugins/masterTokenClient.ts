import { authClient } from '../../auth'
import { StandardLinkOptions, StandardLinkPlugin } from '@orpc/client/standard'
import type { ClientContext } from '@orpc/client'
import { hasMasterTokenPlugin } from '@deployer/auth/client'
import { readDevtoolsApiKey } from '@/components/devtools/use-devtools-api-key'

/**
 * Devtools auth plugin for the ORPC client.
 *
 * Attaches a Bearer header when the devtools "Dev Auth" toggle is on, so the
 * dashboard can act as an impersonated user without a full sign-in.
 *
 * The token is a **scoped API key** minted through the session the developer
 * already has (`authClient.apiKey.create`), cached in `sessionStorage`.
 *
 * It is deliberately NOT `NEXT_PUBLIC_DEV_AUTH_KEY` any more. That variable held
 * the API's master token — a platform-wide super-admin credential — and being
 * `NEXT_PUBLIC_*` it was inlined into the client bundle at build time, so it
 * shipped to every browser that loaded the app. A minted key is scoped,
 * expiring, revocable, and never exposes a server secret.
 *
 * @template TContext - The base context type
 */
export class MasterTokenPlugin<T extends ClientContext> implements StandardLinkPlugin<T> {
  /** Unique plugin name — oRPC v2 requires it for ordering identification. */
  public readonly name = 'master-token'

  init(link: StandardLinkOptions<T>): StandardLinkOptions<T> {
    const transportInterceptors = link.transportInterceptors ?? []

    return {
      ...link,
      transportInterceptors: [
        ...transportInterceptors,
        async (options) => {
      // Only in development — matches the server plugin's own gating.
      if (process.env.NODE_ENV !== 'development') {
        return options.next?.(options)
      }

      // Only proceed if the auth client carries the devtools plugin.
      if (!hasMasterTokenPlugin(authClient)) {
        return options.next?.(options)
      }

      // Single source of truth for the token, shared with the devtools panel.
      // Returns null unless the toggle is on AND a key has been minted, so a
      // disabled or un-minted devtools session leaves requests untouched.
      const token = readDevtoolsApiKey()
      if (!token) {
        return options.next?.(options)
      }

      // `request.headers` is a plain object on the ORPC link (see
      // cookie-headers-plugin.ts), not a `Headers` instance — assign directly.
      options.request.headers = {
        ...options.request.headers,
        Authorization: `Bearer ${token}`,
      }

      return options.next?.(options)
        },
      ],
    }
  }
}
