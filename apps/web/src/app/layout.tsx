// import { Monitoring } from 'react-scan/monitoring/next'
import '@repo/ui/styles/globals.css' // ! load the local stylesheets first to allow for overrides of the ui package components
import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { cn } from '@repo/ui/lib/utils'
import ThemeProvider from '@repo/ui/components/theme-provider'
import Loader from '@repo/ui/components/atomics/atoms/Loader'
import ReactQueryProviders from '@/utils/providers/ReactQueryProviders'
import { Suspense, type JSX } from 'react'
import NextAuthProviders from '@/utils/providers/NextAuthProviders/index'
import NextTopLoader from 'nextjs-toploader'
import Validate from '@/lib/auth/validate'
import Script from 'next/script'
import { validateEnv } from '#/env'
import { DynamicTanstackDevTools } from '@/components/devtools/DynamicTanstackDevTools'
import { UIProvider } from '@/contexts/UIContext'
import { NuqsAdapter } from 'nuqs/adapters/next/app'

const fontSans = Inter({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
    title: 'Deployer - Deployment Platform',
    description:
        'Modern deployment platform with Docker and Traefik integration',
}

export default async function RootLayout({
    children,
}: {
    children: React.ReactNode
}): Promise<JSX.Element> {
    const env = validateEnv(process.env)

    return (
        <html lang="en">
            <head>
                {process.env.NODE_ENV === 'development' && env.REACT_SCAN && (
                    <Script
                        src="https://unpkg.com/react-scan/dist/auto.global.js"
                        strategy="beforeInteractive"
                        async
                    />
                )}
            </head>
            <body
                className={cn(
                    fontSans.variable,
                    'bg-background min-h-screen w-full font-sans antialiased'
                )}
            >
                {process.env.NODE_ENV === 'development' &&
                    env.REACT_SCAN &&
                    env.REACT_SCAN_TOKEN && (
                        // <Monitoring
                        //     apiKey={env.REACT_SCAN_TOKEN} // Safe to expose publically
                        //     url="https://monitoring.react-scan.com/api/v1/ingest"
                        //     commit={env.REACT_SCAN_GIT_COMMIT_HASH} // optional but recommended
                        //     branch={env.REACT_SCAN_GIT_BRANCH} // optional but recommended
                        // />
                        <></>
                    )}
                <NextAuthProviders>
                    <Validate>
                        <NuqsAdapter>
                            <ThemeProvider
                                attribute="class"
                                defaultTheme="system"
                                enableSystem
                                disableTransitionOnChange
                            >
                                <UIProvider>
                                    <NextTopLoader />
                                    <ReactQueryProviders>
                                        <Suspense
                                            fallback={
                                                <div className="flex h-screen w-screen items-center justify-center">
                                                    <Loader />
                                                </div>
                                            }
                                        >
                                            {children}
                                        </Suspense>

                                        <DynamicTanstackDevTools />
                                    </ReactQueryProviders>
                                </UIProvider>
                            </ThemeProvider>
                        </NuqsAdapter>
                    </Validate>
                </NextAuthProviders>
            </body>
        </html>
    )
}
