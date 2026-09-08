// import { Monitoring } from 'react-scan/monitoring/next'
import '@repo/ui/styles/globals.css'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet.fullscreen/dist/Control.FullScreen.css'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
// Configure server auth for declarative routing SessionPage wrappers
// This must be imported before any SessionPage is used
import '@/routes/configure-auth'
import type { Metadata } from 'next'
import { Inter, Geist, Space_Grotesk, JetBrains_Mono } from 'next/font/google'
import { Suspense, type JSX } from 'react'
import { cn } from '@repo/ui/lib/utils'
import ThemeProvider from '@repo/ui/components/theme-provider'
import ReactQueryProviders from '@/utils/providers/ReactQueryProviders'
import AuthProviders from '@/utils/providers/AuthProviders/index'
import NextTopLoader from 'nextjs-toploader'
import Script from 'next/script'
import { validateEnvSafe } from '#/env'
import { Toaster } from '@repo/ui/components/shadcn/sonner'
import { PostSetupHints } from '@/components/setup/post-setup-hints'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

// Font stack — the fleet console's typographic identity:
//   - Geist (--font-sans): neutral UI body at high density.
//   - Space Grotesk (--font-display): display/numerals — industrial, technical.
//   - JetBrains Mono (--font-mono): all machine truth — ids, hashes, tasks, metrics.
const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })
const spaceGrotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-display' })
const jetBrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' })

export const metadata: Metadata = {
    title: 'Deployer',
    description: 'Self-hosted deployment platform',
}

/**
 * Root Layout
 * 
 * Provides global providers and configuration. Each route group handles its own
 * navigation and layout structure:
 * 
 * - (app)/ - Public pages with MainNavigation
 * - (dashboard)/ - Dashboard pages with DashboardSidebar
 * - (auth)/ - Auth pages (login, etc.) - minimal layout
 * - auth/ - Auth API routes
 * 
 * This separation ensures no layout flash when navigating between different sections.
 */
export default function RootLayout({
    children,
}: {
    children: React.ReactNode
}): JSX.Element {
    // Use safe validation to avoid build-time errors during prerendering
    // Environment variables may not be available during static generation
    const envResult = validateEnvSafe(process.env)
    const env = envResult.success ? envResult.data : null

    return (
        <html
            lang="en"
            // next-themes (ThemeProvider with attribute="class" + enableSystem)
            // applies the `dark` class and `color-scheme` style on the client
            // BEFORE hydration. Without suppressHydrationWarning, React logs a
            // hydration mismatch on every load ("A tree hydrated but some
            // attributes of the server rendered HTML didn't match...").
            suppressHydrationWarning
            className={cn('font-sans', geist.variable, spaceGrotesk.variable, jetBrainsMono.variable)}
        >
            <head>
                <link rel="manifest" href="/site.webmanifest" />
                <meta name="theme-color" content="#000000" />
                <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
                {process.env.NODE_ENV === 'development' && env?.REACT_SCAN && (
                    <Script
                        src="https://unpkg.com/react-scan/dist/auto.global.js"
                        strategy="beforeInteractive"
                        async
                    />
                )}
            </head>
            <body
                className={cn(
                    geist.variable,
                    spaceGrotesk.variable,
                    jetBrainsMono.variable,
                    'bg-background flex h-dvh w-dvw flex-col font-sans antialiased'
                )}
            >
                {process.env.NODE_ENV === 'development' &&
                    env?.REACT_SCAN &&
                    env.REACT_SCAN_TOKEN && (
                        // <Monitoring
                        //     apiKey={env.REACT_SCAN_TOKEN} // Safe to expose publically
                        //     url="https://monitoring.react-scan.com/api/v1/ingest"
                        //     commit={env.REACT_SCAN_GIT_COMMIT_HASH} // optional but recommended
                        //     branch={env.REACT_SCAN_GIT_BRANCH} // optional but recommended
                        // />
                        <></>
                    )}
                <AuthProviders>
                    <ThemeProvider
                        attribute="class"
                        defaultTheme="system"
                        enableSystem
                        disableTransitionOnChange
                    >
                        <NextTopLoader />
                        {/* NuqsAdapter is the documented root-layout integration
                            (nuqs.dev/docs/adapters). It works during SSR/prerender:
                            its internal NavigationSpy is already wrapped in Suspense
                            by the adapter itself. Consumers of nuqs state that need
                            URL data on dynamic routes must have a Suspense boundary
                            above them — handled per-route, not here. */}
                        <NuqsAdapter>
                            <ReactQueryProviders>
                                {children}
                                <Toaster richColors closeButton position="top-right" />
                                <PostSetupHints />
                            </ReactQueryProviders>
                        </NuqsAdapter>
                    </ThemeProvider>
                </AuthProviders>
            </body>
        </html>
    )
}
