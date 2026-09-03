import { DashboardSidebar, DashboardLoadingSkeleton, SearchTrigger, HeaderLiveStatus, CommandPalette, KeyboardShortcutsProvider } from '@/components/dashboard'
import { NodeScopePicker } from '@/components/dashboard/node-scope-picker'
import { PostSetupHints } from '@/components/setup/post-setup-hints'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@repo/ui/components/shadcn/sidebar'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { DashboardBreadcrumbs } from '@/components/dashboard/DashboardBreadcrumbs'
import { createSessionLayout } from '@repo/declarative-routing/layout-wrappers/server'
import { SessionHydrationProvider } from '@/utils/providers/SessionHydrationProvider'
import { NodeScopeProvider } from '@/domains/node/node-context'
import { QueryErrorBoundary } from '@/components/error'
import { Suspense } from 'react'
// Import to trigger server-side auth configuration (including layout auth)
import '@/routes/configure-auth'

/**
 * Dashboard Layout with Session Hydration and Error Boundaries
 * 
 * Uses createSessionLayout to:
 * 1. Fetch session on the server
 * 2. Hydrate React Query cache with session data
 * 3. Make session available to ALL child components via useSession()
 * 
 * NOTE: No Suspense wrapper around SessionHydrationProvider!
 * createSessionLayout already has an internal Suspense boundary.
 * Adding another Suspense causes a loading flash ("big displacement").
 * By not wrapping in Suspense, the server waits for session data before
 * streaming the entire layout, eliminating any visual flash.
 * 
 * DashboardSidebar and DashboardBreadcrumbs call usePathname() (URL data).
 * On routes with dynamic params not covered by generateStaticParams, the
 * pathname suspends during prerendering. The Suspense boundaries MUST live
 * in this server layout (not inside the client components) so the static
 * shell can commit — the sidebar and breadcrumbs stream in behind their
 * skeletons after the pathname resolves.
 * 
 * QueryErrorBoundary wraps the main content to catch and handle data
 * fetching errors gracefully, providing retry functionality.
 */
export default createSessionLayout(({ children }) => {
  // session is available via createSessionLayout but we don't need to access it
  // because it's hydrated to React Query - child components use useSession()
  return (
    <SessionHydrationProvider>
      {/* DashboardSidebar and DashboardBreadcrumbs call usePathname() (URL
          data) which suspends during prerendering on dynamic routes. The
          Suspense boundary MUST be a direct server child (not inside the
          client SidebarProvider) so the static shell can commit — the
          sidebar and breadcrumbs stream in behind their skeletons after
          the pathname resolves. */}
      <Suspense fallback={<DashboardLoadingSkeleton />}>
        <SidebarProvider>
          <NodeScopeProvider>
          {/* Skip link — lets keyboard users bypass sidebar + header navigation */}
          <a
            href="#main-content"
            className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-3 focus:top-3"
          >
            Skip to main content
          </a>
          <DashboardSidebar />
          <SidebarInset className="bg-linear-to-b from-primary/[0.06] via-background to-background">
            {/* Header with trigger, breadcrumbs, search and live status */}
            <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-background/85 px-4 backdrop-blur-xl">
              <div className="flex min-w-0 items-center gap-2">
                <SidebarTrigger className="-ml-1" />
                <Separator orientation="vertical" className="mr-1 h-4" />
                <DashboardBreadcrumbs />
              </div>
              <div className="flex items-center gap-2">
                <NodeScopePicker />
                <HeaderLiveStatus />
                <SearchTrigger />
              </div>
            </header>
            
            {/* Main content with error boundary */}
            <main id="main-content" className="flex-1 overflow-y-auto">
              <QueryErrorBoundary context="Dashboard">
                <div className="mx-auto w-full max-w-screen-2xl px-4 py-7 xl:px-6">
                  {children}
                </div>
              </QueryErrorBoundary>
            </main>
          </SidebarInset>
          <PostSetupHints />
          {/* Global operator layers: ⌘K palette + keyboard navigation */}
          <CommandPalette />
          <KeyboardShortcutsProvider />
          </NodeScopeProvider>
        </SidebarProvider>
      </Suspense>
    </SessionHydrationProvider>
  )
}, {
  // Beautiful loading skeleton shown during initial session fetch
  fallback: <DashboardLoadingSkeleton />,
})
