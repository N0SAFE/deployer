import { Suspense, type JSX } from 'react'
import MainNavigation from '@/components/navigation/MainNavigation'
import { SessionHydrationProvider } from '@/utils/providers/SessionHydrationProvider'
import Loader from '@repo/ui/components/atomics/atoms/Loader'

/**
 * App Route Group Layout
 * 
 * This layout is for public/general pages that use the main navigation bar:
 * - Home page (/)
 * - Any other pages that should have the top navbar
 * 
 * The dashboard has its own separate route group with sidebar navigation.
 * 
 * SessionHydrationProvider reads cookies() (request-time data). Wrapping it
 * in a Suspense boundary keeps the page content in the static shell — the
 * session (and nav) streams in after the cookie read resolves. The fallback
 * is a nav-shaped skeleton so the shell is never blank while the session
 * resolves.
 */
export default function AppLayout({
    children,
}: {
    children: React.ReactNode
}): JSX.Element {
    return (
        <>
            <Suspense fallback={<NavSkeleton />}>
                <SessionHydrationProvider>
                    {/* MainNavigation calls usePathname() (URL data) which
                        suspends during prerendering on dynamic routes. The
                        Suspense boundary must be in this server tree — the
                        nav shell streams in behind its skeleton after the
                        pathname resolves. */}
                    <Suspense fallback={<NavSkeleton />}>
                        <MainNavigation />
                    </Suspense>
                </SessionHydrationProvider>
            </Suspense>
            <Suspense
                fallback={
                    <div className="flex h-screen w-screen items-center justify-center">
                        <Loader />
                    </div>
                }
            >
                <main className="flex flex-1 flex-col overflow-y-auto">
                    {children}
                </main>
            </Suspense>
        </>
    )
}

/**
 * NavSkeleton — nav-bar-shaped loading state shown while the session
 * (and the session-dependent nav) streams in. Mirrors the real nav layout:
 * logo left, links center, auth control right.
 */
function NavSkeleton() {
    return (
        <nav className="bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur flex justify-center">
            <div className="container flex h-14 items-center justify-between">
                <div className="flex items-center space-x-4">
                    <div className="bg-primary/80 flex h-8 w-8 items-center justify-center rounded-md">
                        <div className="h-4 w-4 animate-pulse rounded-sm bg-primary-foreground/60" />
                    </div>
                    <div className="h-4 w-20 animate-pulse rounded bg-muted" />
                </div>
                <div className="flex items-center space-x-4">
                    <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
                    <div className="h-8 w-20 animate-pulse rounded-md bg-muted" />
                </div>
                <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
            </div>
        </nav>
    )
}
