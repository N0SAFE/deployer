'use client'

import { useSearchParams } from 'next/navigation'
import { AlertCircle } from 'lucide-react'
import { AuthSignin } from '@/routes'
import { Button } from '@deployer/ui/components/shadcn/button'

interface AuthErrorCopy {
    title: string
    message: string
}

const errorMessages: Record<string, AuthErrorCopy> = {
    Configuration: {
        title: 'Sign-in is misconfigured',
        message: 'The server could not complete authentication. This is a setup problem, not something you did. Ask an administrator to check the server logs.',
    },
    AccessDenied: {
        title: 'Access denied',
        message: 'Your account is not allowed to open this page. Ask an administrator to grant you access.',
    },
    Verification: {
        title: 'Link expired or invalid',
        message: 'This verification link is no longer valid. Request a new one and use it right away.',
    },
}

const FALLBACK: AuthErrorCopy = {
    title: 'Sign-in failed',
    message: 'Something went wrong while signing you in. Try again; if it keeps happening, ask an administrator.',
}

/** Pure lookup (exported for tests). */
export function authErrorCopy(code: string): AuthErrorCopy {
    return errorMessages[code] ?? FALLBACK
}

/**
 * AuthErrorContent — client inner for the auth error page. Reads
 * useSearchParams() (suspends during prerendering), so the server page wraps
 * it in Suspense.
 */
export function AuthErrorContent() {
    const search = useSearchParams()
    const errorCode = search.get('error') ?? 'Configuration'
    const errorInfo = authErrorCopy(errorCode)

    return (
        <div className="flex min-h-[70vh] w-full flex-col items-center justify-center px-4">
            <div role="alert" className="border-border bg-card block w-full max-w-sm rounded-lg border p-6 text-center shadow-sm">
                <div className="bg-destructive/10 mx-auto mb-3 flex size-12 items-center justify-center rounded-full">
                    <AlertCircle className="text-destructive size-6" aria-hidden />
                </div>
                <h1 className="text-foreground mb-2 text-xl font-semibold tracking-tight">{errorInfo.title}</h1>
                <p className="text-muted-foreground text-sm">{errorInfo.message}</p>
                <p className="text-muted-foreground mt-3 text-sm">
                    Error code: <code className="bg-muted rounded-sm px-1.5 py-0.5 font-mono text-xs">{errorCode}</code>
                </p>
                <Button asChild className="mt-4 w-full">
                    <AuthSignin.Link>Back to sign in</AuthSignin.Link>
                </Button>
            </div>
        </div>
    )
}
