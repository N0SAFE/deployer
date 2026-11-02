 
import {
    getMasterTokenEnabled,
    setMasterTokenEnabled,
    clearMasterToken,
    getDevtoolsApiKey,
    MasterTokenManager,
} from './state'

import type { BetterAuthClientPlugin, BetterFetch, ClientStore, BetterAuthClientOptions } from 'better-auth/client'

/**
 * Better Auth client plugin to attach a master token Authorization header
 * when the devtools dev-auth flag is enabled. This keeps auth-related
 * behavior colocated under `lib/auth/plugins`.
 */
export const masterTokenClient = () =>
    ({
         
        getActions: (_$fetch: BetterFetch, _$store: ClientStore, _options: BetterAuthClientOptions | undefined) => {
            const createMasterTokenSignOut = <TSignOut extends (...args: unknown[]) => Promise<unknown>>(signOutFn: TSignOut) => {
                return async (...args: Parameters<TSignOut>): Promise<Awaited<ReturnType<TSignOut>> | null> => {
                    // If dev auth mode is active in development, we want to disable the
                    // dev-auth token mode and then refresh the client session instead of
                    // performing a real sign-out. This keeps the UX local to the browser
                    // when using the development master token flow.
                    if (
                        typeof window !== 'undefined' &&
                        process.env.NODE_ENV === 'development'
                    ) {
                        if (!MasterTokenManager.state) {
                            // If dev auth mode is not active, fall through to the original
                            // signOut behavior to ensure sign-out still works.
                            return signOutFn(...args) as Promise<Awaited<ReturnType<TSignOut>>>
                        }
                        try {
                            MasterTokenManager.change(false)
                            return null
                        } catch {
                            // Defensive: if anything in our dev-only flow fails, fall through
                            // to the original signOut behavior to ensure sign-out still works.
                            console.warn(
                                'master-token signOut interception failed, falling back'
                            )
                        }
                    }
                    
                    // In production or on server side, always call the original signOut
                    return signOutFn(...args) as Promise<Awaited<ReturnType<TSignOut>>>
                }
            }

            return {
                getMasterTokenEnabled,
                setMasterTokenEnabled,
                clearMasterToken,
                MasterTokenManager,
                // We'll set this dynamically when the client is created
                $masterTokenSignOut: createMasterTokenSignOut,
            }
        },
        id: 'master-token-client',
        fetchPlugins: [
            {
                hooks: {
                    onRequest: (ctx) => {
                        if (!MasterTokenManager.state) {
                            return ctx
                        }

                        // Only enable in development to avoid leaking secrets in production
                        if (process.env.NODE_ENV !== 'development') return ctx

                        try {
                            // The bearer credential is a scoped API key minted by
                            // the devtools hook and stored in sessionStorage — NOT
                            // `NEXT_PUBLIC_DEV_AUTH_KEY`, which was the platform
                            // master token inlined into the client bundle.
                            //
                            // Read through the same accessor the ORPC link plugin
                            // uses so the two cannot drift.
                            const key = getDevtoolsApiKey()
                            if (!key) return ctx

                            // Better Auth types the plugin context loosely, so the header bag is narrowed once here
                            // instead of letting `any` propagate through every spread.
                            const rawHeaders: unknown = (ctx as { readonly headers?: unknown }).headers
                            const headerPairs: Record<string, string> = Array.isArray(rawHeaders)
                                ? Object.fromEntries(rawHeaders as readonly (readonly [string, string])[])
                                : typeof rawHeaders === "object" && rawHeaders !== null
                                    ? (rawHeaders as Record<string, string>)
                                    : {}

                            return { ...ctx, headers: new Headers({ Authorization: `Bearer ${key}`, ...headerPairs }) }
                        } catch (e) {
                            // defensive fallback
                            console.warn(
                                'masterTokenClientPlugin: failed to build header',
                                e
                            )
                            return ctx
                        }
                    },
                },
                id: 'master-token-header',
                name: 'Master Token Header Plugin',
            },
        ],
    }) satisfies BetterAuthClientPlugin

export default masterTokenClient
