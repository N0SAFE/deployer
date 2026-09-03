'use client'

import { useSearchParams } from 'next/navigation'
import { AuthSignin } from '@/routes'
import { Button } from '@repo/ui/components/shadcn/button'

enum AuthErrorType {
    Configuration = 'Configuration',
    AccessDenied = 'AccessDenied',
    Verification = 'Verification',
}

const errorMessages: Record<string, { title: string; message: string }> = {
    [AuthErrorType.Configuration]: {
        title: 'Configuration Error',
        message: 'There was a problem when trying to authenticate. Please contact us if this error persists.',
    },
    [AuthErrorType.AccessDenied]: {
        title: 'Access Denied',
        message: 'You do not have permission to access this resource.',
    },
    [AuthErrorType.Verification]: {
        title: 'Verification Error',
        message: 'The verification link is invalid or has expired.',
    },
}

/**
 * AuthErrorContent — client inner for the auth error page.
 *
 * Reads useSearchParams() (URL data) which suspends during prerendering.
 * Rendered inside a Suspense boundary in the server page so the route
 * stays prerenderable — the error content streams in after the search
 * params resolve.
 */
export function AuthErrorContent() {
    const search = useSearchParams()
    const errorCode = search.get('error') ?? 'Configuration'
    const errorInfo = errorMessages[errorCode] ?? { title: 'Unknown Error', message: 'An unexpected error occurred.' }

    return (
        <div className="flex h-screen w-full flex-col items-center justify-center">
            <div className="block max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-sm">
                <h5 className="mb-2 flex flex-row items-center justify-center gap-2 text-xl font-bold tracking-tight text-foreground">
                    {errorInfo.title}
                </h5>
                <div className="font-normal text-muted-foreground">
                    {errorInfo.message}
                    <code className="mt-2 block rounded-sm bg-muted p-1 text-xs">{errorCode}</code>
                </div>
                <AuthSignin.Link>
                    <Button className="mt-4 w-full" variant="default">
                        Back to sign in
                    </Button>
                </AuthSignin.Link>
            </div>
        </div>
    )
}