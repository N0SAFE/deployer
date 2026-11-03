import "server-only";

import { QueryClient, HydrationBoundary, dehydrate } from "@tanstack/react-query";
import React, { type ReactNode } from "react";

import { DEFAULT_SESSION_QUERY_KEY } from "./shared";

/**
 * Props for SessionHydration component.
 */
export interface SessionHydrationProps<TSession> {
    /**
     * Children to render. Will have access to hydrated session data via React Query cache.
     */
    children: ReactNode;
    /**
     * Function to fetch the session on the server.
     * Can return either:
     * - Direct session: Session | null
     * - Wrapped session: { data: Session | null }
     */
    fetchSession: () => Promise<TSession | { data: TSession | null | undefined } | null>;
    /**
     * Optional custom query key for the session.
     * @default ['session']
     */
    sessionQueryKey?: readonly unknown[];
    /**
     * Optional: Skip session fetch if condition is false.
     * Useful for checking auth cookies before fetching.
     * @default true
     */
    shouldFetch?: boolean;
}

/**
 * Server component that pre-hydrates the session into React Query cache.
 *
 * This component:
 * 1. Fetches the session on the server
 * 2. Populates a QueryClient with the session data
 * 3. Wraps children with HydrationBoundary
 *
 * When placed in a layout above client components using useSession(),
 * those components will immediately have access to the hydrated session
 * without needing to refetch or subscribe to cache updates.
 *
 * @example
 * ```tsx
 * // In layout.tsx (server component)
 * import { SessionHydration } from './server'
 * import { getSession } from '../../../../../lib/auth'
 *
 * export default function RootLayout({ children }) {
 *   return (
 *     <html>
 *       <body>
 *         <ReactQueryProviders>
 *           <SessionHydration fetchSession={getSession}>
 *             <MainNavigation />
 *             {children}
 *           </SessionHydration>
 *         </ReactQueryProviders>
 *       </body>
 *     </html>
 *   )
 * }
 * ```
 */
export async function SessionHydration<TSession>({
    children,
    fetchSession,
    sessionQueryKey = DEFAULT_SESSION_QUERY_KEY,
    shouldFetch = true,
}: SessionHydrationProps<TSession>): Promise<React.ReactElement> {
    const queryClient = new QueryClient();

    // Fetch session if we should
    let session: TSession | null = null;
    if (shouldFetch) {
        const result = await fetchSession();

        // Handle both formats:
        // - Direct session: Session | null
        // - Wrapped session: { data: Session | null }
        if (result !== null && result !== undefined) {
            // Check if it's a wrapped response with 'data' property
            if (typeof result === "object" && "data" in result) {
                session = (result).data ?? null;
            } else {
                // It's a direct session object
                session = result;
            }
        }
    }

    // ALWAYS set the session in the query cache, even if null — and even when
    // `shouldFetch` is false. null means "known: not logged in"; a MISSING entry
    // means "not yet fetched", which makes `useSession()` fall through to Better
    // Auth's own client fetch and render a different branch than the server did.
    //
    // `updatedAt: 0` instead of the default `Date.now()`: a bare setQueryData
    // stamps the current time, which is a prerender-time read and trips
    // `blocking-prerender-current-time`. The value is irrelevant here — the
    // session query is `staleTime: Infinity` — so pinning it keeps the write
    // deterministic and prerender-safe.
    queryClient.setQueryData(sessionQueryKey, session, { updatedAt: 0 });

    // Dehydrate the query client state
    const dehydratedState = dehydrate(queryClient);

    return <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>;
}

/**
 * Factory function to create a typed SessionHydration component.
 *
 * @example
 * ```tsx
 * // In your auth module
 * import { createSessionHydration } from './server'
 * import { getSession } from '@/react/session/auth'
 *
 * export const SessionHydration = createSessionHydration({
 *   fetchSession: getSession,
 *   sessionQueryKey: ['session'],
 * })
 *
 * // Then use in layout.tsx
 * <SessionHydration>
 *   <MainNavigation />
 *   {children}
 * </SessionHydration>
 * ```
 */
export function createSessionHydration<TSession>(config: Omit<SessionHydrationProps<TSession>, "children">): React.FC<{ children: ReactNode }> {
    return async function ConfiguredSessionHydration({ children }) {
        return SessionHydration<TSession>({
            ...config,
            children,
        });
    };
}
