'use client'

import React from 'react'
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

const MainNavigation: React.FC = () => {
    const pathname = usePathname()
    const docsUrl = validateEnvPath(process.env.NEXT_PUBLIC_DOC_URL, 'NEXT_PUBLIC_DOC_URL')
    
    // Session is pre-hydrated by SessionHydrationProvider in the layout.
    // Since there's no Suspense boundary, the server waits for session fetch
    // before sending HTML, so useSession reads from already-populated cache.
    // isPending should be false immediately.
    const { data: session, isPending } = useSession()

    const isActive = (path: string) => pathname === path
    const isActivePath = (path: string) => pathname.startsWith(path)

    // Note: MainNavigation is now only rendered in (app) route group
    // Dashboard has its own layout with DashboardSidebar

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

                    {/* Dashboard link - visible only when authenticated */}
                    {session?.user && (
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
                    )}
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

                <div className="flex items-center space-x-2">
                    {isPending ? (
                        <div className="bg-muted h-8 w-8 animate-pulse rounded-md" />
                    ) : session?.user ? (
                        <div className="flex items-center space-x-2">
                            <SignOutButton />
                        </div>
                    ) : (
                        <AuthSignin.Link>
                            <Button variant="default" size="sm">
                                Sign In
                            </Button>
                        </AuthSignin.Link>
                    )}
                </div>
            </div>
        </nav>
    )
}

export default MainNavigation
