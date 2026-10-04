import { authClient } from '../../auth'
import { StandardLinkOptions, StandardLinkPlugin } from '@orpc/client/standard'
import type { ClientContext } from '@orpc/client'
import { hasMasterTokenPlugin } from '@repo/auth/client'

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

      // ── SERVER-SIDE RENDERS NEVER CARRY A DEVTOOLS KEY ────────────────────────
      // The key lives in `sessionStorage`, which does not exist on the server, so
      // there is nothing to attach — but the READ itself is the problem: it lives
      // in a `'use client'` module, and importing/calling it during a server render
      // throws a client-boundary error that has nothing to do with auth:
      //
      //   Error fetching API health: Attempted to call readDevtoolsApiKey() from
      //   the server but readDevtoolsApiKey is on the client. It's not possible to
      //   invoke a client function from the server…
      //
      // That surfaced through the web app's OWN health route, which calls this
      // client server-side and reported `api: unavailable` with HTTP 503 on a
      // fully healthy stack — making the indicator useless.
      //
      // The guard is on `window` rather than only inside the reader because the
      // throw comes from the BUNDLER/loader boundary, before the reader's own
      // `typeof window` check can run.
      if (typeof window === 'undefined') {
        return options.next?.(options)
      }

      // Only proceed if the auth client carries the devtools plugin.
      if (!hasMasterTokenPlugin(authClient)) {
        return options.next?.(options)
      }

      // Single source of truth for the token, shared with the devtools panel.
      // Returns null unless the toggle is on AND a key has been minted, so a
      // disabled or un-minted devtools session leaves requests untouched.
      //
      // Imported LAZILY so a server render never evaluates the `'use client'`
      // module graph this lives in.
      const { readDevtoolsApiKey } = await import('@/components/devtools/use-devtools-api-key')
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
