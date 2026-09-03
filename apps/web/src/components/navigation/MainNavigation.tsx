'use client'

import React, { Suspense } from 'react'
import { usePathname } from 'next/navigation'
import { Button } from '@repo/ui/components/shadcn/button'
import {
    Home,
    AuthSignin,
    AuthDashboard,
} from '@/routes'
import { useSession } from '@/lib/auth'
import {
    Home as HomeIcon,
    Server,
    LayoutDashboard,
} from 'lucide-react'
import SignOutButton from '../signout/signoutButton'
import { validateEnvPath } from '#/env'

/**
 * MainNavigation — top navigation bar for the (app) route group.
 * 
 * The nav shell (logo, Home, Docs) renders statically. The session-dependent
 * right side (Sign In / Dashboard / Sign Out) calls useSession(), which
 * subscribes to Better Auth's session atom — that subscription triggers a
 * Date.now() during prerendering (blocking-prerender-current-time). Deferring
 * only the session-dependent part behind its own Suspense boundary keeps the
 * nav shell in the static shell while the auth state streams in.
 * 
 * The usePathname() read is covered by the Suspense boundary in the (app)
 * layout (server tree) — this component must NOT wrap itself in Suspense
 * because a boundary inside a client component does not help server-side
 * prerendering.
 */
const MainNavigation: React.FC = () => {
    const pathname = usePathname()
    const docsUrl = validateEnvPath(process.env.NEXT_PUBLIC_DOC_URL, 'NEXT_PUBLIC_DOC_URL')

    const isActive = (path: string) => pathname === path
    const isActivePath = (path: string) => pathname.startsWith(path)

    return (
        <nav className="bg-background/95 supports-backdrop-filter:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur flex justify-center">
            <div className="container flex h-14 items-center justify-between">
                <div className="flex items-center space-x-4">
                    <Home.Link className="flex items-center space-x-2">
                        <div className="bg-primary text-primary-foreground flex h-8 w-8 items-center justify-center rounded-md">
                            <HomeIcon className="h-4 w-4" />
                        </div>
                        <span className="font-bold">Deployer</span>
                    </Home.Link>
                </div>

                <div className="flex items-center space-x-4">
                    <Home.Link>
                        <Button
                            variant={isActive('/') ? 'default' : 'ghost'}
                            size="sm"
                            className="flex items-center space-x-2"
                        >
                            <HomeIcon className="h-4 w-4" />
                            <span>Home</span>
                        </Button>
                    </Home.Link>

                    {/* Dashboard link — session-dependent, deferred */}
                    <Suspense fallback={null}>
                        <DashboardNavLink isActivePath={isActivePath} />
                    </Suspense>

                    {docsUrl && (
                        <a href={docsUrl} target="_blank" rel="noreferrer">
                            <Button
                                variant={isActive('/docs') ? 'default' : 'ghost'}
                                size="sm"
                                className="flex items-center space-x-2"
                            >
                                <Server className="h-4 w-4" />
                                <span>Docs</span>
                            </Button>
                        </a>
                    )}
                </div>

                {/* Session-dependent right side — deferred behind a skeleton */}
                <Suspense
                    fallback={
                        <div className="bg-muted h-8 w-8 animate-pulse rounded-md" aria-hidden />
                    }
                >
                    <SessionNav />
                </Suspense>
            </div>
        </nav>
    )
}

/** Dashboard link — only visible when authenticated. */
function DashboardNavLink({ isActivePath }: { isActivePath: (path: string) => boolean }) {
    const { data: session } = useSession()
    if (!session?.user) return null
    return (
        <AuthDashboard.Link>
            <Button
                variant={isActivePath('/dashboard') ? 'default' : 'ghost'}
                size="sm"
                className="flex items-center space-x-2"
            >
                <LayoutDashboard className="h-4 w-4" />
                <span>Dashboard</span>
            </Button>
        </AuthDashboard.Link>
    )
}

/** Sign In / Sign Out — depends on the session atom. */
function SessionNav() {
    const { data: session, isPending } = useSession()
    if (isPending) {
        return <div className="bg-muted h-8 w-8 animate-pulse rounded-md" aria-hidden />
    }
    if (session?.user) {
        return (
            <div className="flex items-center space-x-2">
                <SignOutButton />
            </div>
        )
    }
    return (
        <AuthSignin.Link>
            <Button variant="default" size="sm">
                Sign In
            </Button>
        </AuthSignin.Link>
    )
}

export default MainNavigation
