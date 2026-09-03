'use client'


// Using typed routing: replace raw next/link with declarative routes

import { getErrorMessage } from "@/lib/orpc/typed-errors";
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { useForm } from '@tanstack/react-form'
import React, { Suspense } from 'react'
import redirect from '@/actions/redirect'
import { AlertCircle, Spinner } from '@repo/ui/components/atomics/atoms/Icon'
import { loginSchema } from './schema'
import { AuthSignin, AuthSignup, Setup } from '@/routes'
import { Shield } from 'lucide-react'
import { authClient } from '@/lib/auth'
import { PageTimingLogger } from '@/lib/timing'
import { useSetupState } from '@/domains/setup/hooks'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * Resolve the post-sign-in destination at SUBMIT time.
 *
 * Reads window.location.search directly instead of useSearchParams(): the
 * submit handler runs on a client event, so no render-time URL-data read is
 * needed — this is what lets the whole form live in the static shell.
 * Same fallback chain as before: redirectTo ?? callbackUrl ?? '/'.
 */
function getPostSignInTarget(): string {
    if (typeof window === 'undefined') return '/'
    const params = new URLSearchParams(window.location.search)
    return params.get('redirectTo') ?? params.get('callbackUrl') ?? '/'
}

/**
 * SetupGate — deferred leaf that redirects to /setup on fresh installs.
 *
 * Reads searchParams + setup state (URL/request data) which suspend during
 * prerendering. Isolated here so the sign-in form itself stays in the static
 * shell. Renders nothing once setup is done (the common case); while a
 * redirect is pending it covers the viewport with the same centered spinner
 * the page used to swap itself for.
 */
function SetupGate() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { data: setupStatus } = useSetupState()

    React.useEffect(() => {
        if (setupStatus?.needsSetup) {
            void router.replace(
                Setup(
                    {},
                    {
                        redirectTo:
                            searchParams.get('redirectTo') ??
                            searchParams.get('callbackUrl') ??
                            undefined,
                    }
                )
            )
        }
    }, [setupStatus, router, searchParams])

    if (!setupStatus?.needsSetup) return null

    return (
        <div className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
                <Spinner /> Redirecting to setup...
            </div>
        </div>
    )
}

/**
 * SignUpLink — deferred leaf forwarding ?redirectTo/?callbackUrl to sign-up.
 *
 * The link href depends on searchParams (URL data) which suspends during
 * prerendering. Isolated behind its own boundary; the fallback mirrors the
 * link's size so layout doesn't shift when it resolves.
 */
function SignUpLink() {
    const searchParams = useSearchParams()
    return (
        <AuthSignup.Link
            search={{
                redirectTo: searchParams.get('redirectTo') ?? undefined,
                callbackUrl: searchParams.get('callbackUrl') ?? undefined,
            }}
            className="text-primary hover:underline"
        >
            Create one here
        </AuthSignup.Link>
    )
}

function SignUpLinkFallback() {
    return (
        <span className="text-muted-foreground animate-pulse">Create one here</span>
    )
}

/**
 * Sign In page.
 *
 * The whole form renders in the static shell — no render-time URL-data reads
 * above it. The two pieces that need search params (setup gate, sign-up link)
 * are isolated in small Suspense-wrapped leaves below the form.
 */
export default AuthSignin.Route(function SignInPage({ searchParams }) {
    // ─── Hooks (must always be called in the same order — no early return before) ───
    const [authError, setAuthError] = React.useState<string | null>(null)

    const form = useForm({
        defaultValues: {
            email: '',
            password: '',
        },
        // Native TanStack Form validation: the zod schema runs as fields
        // change AND again on submit; issues land in each field's
        // `meta.errors`. No manual safeParse / parallel error state needed.
        validators: {
            onChange: loginSchema,
        },
        onSubmit: async ({ value }) => {
            setAuthError(null)

            try {
                const res = await authClient.signIn.email({
                    email: value.email,
                    password: value.password,
                })

                if (res.error) {
                    setAuthError(res.error.message ?? 'Authentication failed')
                    return
                }

                void redirect(getPostSignInTarget())
            } catch (error) {
                // Network failure / unreachable API. Without this catch the
                // rejection was unhandled and `isSubmitting` stayed true,
                // leaving the submit button disabled forever.
                setAuthError(
                    getErrorMessage(error, 'Unable to reach the authentication service'),
                )
            }
        },
    })

    return (
        <div className="flex flex-1 items-center justify-center">
            <Suspense fallback={null}>
                <SetupGate />
            </Suspense>
            <div className="w-full max-w-md space-y-8">
                <Card>
                    <CardHeader className="space-y-4 text-center">
                        <div className="flex justify-center">
                            <div className="bg-primary/10 rounded-full p-3">
                                <Shield className="text-primary h-8 w-8" />
                            </div>
                        </div>
                        <div>
                            <CardTitle className="text-2xl font-bold">
                                Welcome Back
                            </CardTitle>
                            <CardDescription className="text-base">
                                Sign in to your account to access the NestJS
                                application
                            </CardDescription>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <form
                            onSubmit={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                void form.handleSubmit()
                            }}
                            className="space-y-6"
                        >
                            <div className="space-y-4">
                                <form.Field name="email">
                                    {(field) => (
                                        <div className="space-y-2">
                                            <Label htmlFor="email">Email Address</Label>
                                            <Input
                                                placeholder="john@example.com"
                                                id="email"
                                                type="email"
                                                className="h-12"
                                                autoComplete="username"
                                                value={field.state.value}
                                                onBlur={field.handleBlur}
                                                onChange={(event) => field.handleChange(event.target.value)}
                                                aria-invalid={field.state.meta.errors.length > 0}
                                                aria-describedby={field.state.meta.errors.length > 0 ? 'email-error' : undefined}
                                            />
                                            {/* Gate on isTouched: a blur on one field re-validates
                                                the whole form-level schema, so untouched siblings
                                                must not surface their errors yet. */}
                                            {field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
                                                <p id="email-error" role="alert" className="text-sm font-medium text-destructive">
                                                    {field.state.meta.errors[0]?.message}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </form.Field>

                                <form.Field name="password">
                                    {(field) => (
                                        <div className="space-y-2">
                                            <Label htmlFor="password">Password</Label>
                                            <Input
                                                id="password"
                                                type="password"
                                                className="h-12"
                                                autoComplete="current-password"
                                                value={field.state.value}
                                                onBlur={field.handleBlur}
                                                onChange={(event) => field.handleChange(event.target.value)}
                                                aria-invalid={field.state.meta.errors.length > 0}
                                                aria-describedby={field.state.meta.errors.length > 0 ? 'password-error' : undefined}
                                            />
                                            {field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
                                                <p id="password-error" role="alert" className="text-sm font-medium text-destructive">
                                                    {field.state.meta.errors[0]?.message}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </form.Field>

                                {authError && (
                                    <Alert variant="destructive">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>
                                            {authError}
                                        </AlertDescription>
                                    </Alert>
                                )}

                                {/* Form-native submit state — replaces manual isLoading */}
                                <form.Subscribe
                                    selector={(state) => ({
                                        canSubmit: state.canSubmit,
                                        isSubmitting: state.isSubmitting,
                                    })}
                                >
                                    {({ canSubmit, isSubmitting }) => (
                                        <Button
                                            disabled={!canSubmit}
                                            type="submit"
                                            className="h-12 w-full text-base"
                                        >
                                            {isSubmitting && <Spinner />}
                                            Sign In with Email
                                        </Button>
                                    )}
                                </form.Subscribe>
                            </div>

                            <div className="relative">
                                <div className="absolute inset-0 flex items-center">
                                    <span className="w-full border-t" />
                                </div>
                                <div className="relative flex justify-center text-xs uppercase">
                                    <span className="bg-background text-muted-foreground px-2">
                                        Demo Credentials
                                    </span>
                                </div>
                            </div>

                            <div className="bg-muted/50 rounded-lg p-4 text-sm">
                                <p className="text-foreground mb-2 font-medium">
                                    Try the demo:
                                </p>
                                <div className="text-muted-foreground space-y-1">
                                    <p>
                                        <strong>Email:</strong>{' '}
                                        admin@admin.com
                                    </p>
                                    <p>
                                        <strong>Password:</strong> adminadmin
                                    </p>
                                </div>
                            </div>
                        </form>
                    </CardContent>
                </Card>
                <div className="text-muted-foreground text-center text-sm">
                    <p>
                        Don&apos;t have an account?{' '}
                        <Suspense fallback={<SignUpLinkFallback />}>
                            <SignUpLink />
                        </Suspense>
                    </p>
                </div>

                {/* Timing Logger */}
                <PageTimingLogger pageName="Sign In" />
            </div>
        </div>
    )
}
)