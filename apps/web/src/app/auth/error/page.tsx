import { Suspense } from 'react'
import { AuthErrorContent } from './auth-error-content'

import type { Metadata } from 'next'
/**
 * Auth Error Page (server component)
 *
 * The client inner reads useSearchParams() (URL data) which suspends during
 * prerendering. The Suspense boundary lives in this server component so the
 * route stays prerenderable — the error content streams in after the search
 * params resolve.
 */
export default function AuthErrorPage() {
    return (
        <Suspense
            fallback={
                <div className="flex h-screen w-full items-center justify-center">
                    <p className="text-sm text-muted-foreground">Loading…</p>
                </div>
            }
        >
            <AuthErrorContent />
        </Suspense>
    )
}

export const metadata: Metadata = {
    title: "Authentication error",
    description: "There was a problem during authentication",
}
