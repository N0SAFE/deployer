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
import { Badge } from '@repo/ui/components/shadcn/badge'
import { loginSchema } from './schema'
import { AuthSignup } from '@/routes'
import { Fingerprint, Shield } from 'lucide-react'
import { authClient } from '@/lib/auth'
import { PageTimingLogger } from '@/lib/timing'
import { useSetupState } from '@/domains/setup/hooks'
import { setupDestinationUrl } from '@/lib/setup-url'
import { useRouter } from 'next/navigation'

/**
 * Read one query parameter without a suspending hook.
 *
 * `useSearchParams()` suspends during a client prerender, which is what pushed
 * this page's content out of its static shell. `window.location.search` holds
 * the same value once mounted, and is read lazily — inside an effect or an event
 * handler — so no render-time URL-data read remains on the page.
 *
 * Returns `undefined` during SSR, and the real value after the first effect.
 */
function readUrlSearchParam(key: string): string | undefined {
    if (typeof window === 'undefined') return undefined
    return new URLSearchParams(window.location.search).get(key) ?? undefined
}

/**
 * Resolve the post-sign-in destination at SUBMIT time.
 *
 * Reads window.location.search directly instead of useSearchParams(): the
 * submit handler runs on a client event, so no render-time URL-data read is
 * needed — this is what lets the whole form live in the static shell.
 * Same fallback chain as before: redirectTo ?? callbackUrl ?? '/'.
 */
function getPostSignInTarget(): string {
    return (
        readUrlSearchParam('redirectTo') ??
        readUrlSearchParam('callbackUrl') ??
        '/'
    )
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
    const { data: setupStatus } = useSetupState()

    React.useEffect(() => {
        if (setupStatus?.needsSetup) {
            // Setup is a SAME-DEPLOYMENT route now (the web app serves its own
            // /setup via the shared wizard), so this is a normal same-origin
            // navigation — not a cross-origin jump to the API.
            router.replace(
                setupDestinationUrl({
                    redirectTo:
                        readUrlSearchParam('redirectTo') ??
                        readUrlSearchParam('callbackUrl'),
                })
            )
        }
    }, [setupStatus, router])

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
 * The raw query string, read safely during SSR and hydration.
 *
 * `useSyncExternalStore` is the React-sanctioned way to read a browser-only
 * value: `getServerSnapshot` returns `''` for the server render and for
 * hydration, then React re-renders with the live `location.search`. That avoids
 * both a hydration mismatch and the setState-inside-an-effect pattern (which the
 * React Compiler lint rule rejects).
 *
 * No subscription is needed — the URL only changes on navigation, which
 * remounts this subtree.
 */
/** Stable no-op: the URL only changes on navigation, which remounts this subtree. */
function subscribeToNothing(): () => void {
    return noop
}

function noop(): void {
    // Intentionally empty — there is nothing to unsubscribe from.
}

function useUrlSearchString(): string {
    return React.useSyncExternalStore(
        subscribeToNothing,
        () => window.location.search,
        () => '',
    )
}

/**
 * SignUpLink — forwards ?redirectTo/?callbackUrl to the sign-up link.
 *
 * Reads the query string via `useUrlSearchString()` rather than
 * `useSearchParams()`, which would suspend the page during prerendering and
 * empty its static shell. The link is a convenience affordance, so resolving it
 * after hydration is preferable to withholding the whole form.
 */
function SignUpLink() {
    const search = useUrlSearchString()
    const params = React.useMemo(() => new URLSearchParams(search), [search])

    return (
        <AuthSignup.Link
            search={{
                redirectTo: params.get('redirectTo') ?? undefined,
                callbackUrl: params.get('callbackUrl') ?? undefined,
            }}
            className="text-primary hover:underline"
        >
            Create one here
        </AuthSignup.Link>
    )
}

/**
 * "Last used" badge, driven by the Last Login Method plugin.
 *
 * Reads from the plugin's client helper, which stores the method in a cookie —
 * so this is a cheap synchronous read with no request. Rendered as a leaf so it
 * can be dropped next to any sign-in option without threading state.
 */
function LastUsedBadge({ method }: { method: string }) {
    const [isLast, setIsLast] = React.useState(false)

    // Read after mount only: the helper touches `document.cookie`, so reading
    // during render would diverge between server and client HTML.
    React.useEffect(() => {
        try {
            setIsLast(authClient.isLastUsedLoginMethod(method))
        } catch {
            // The helper is absent when the plugin is not registered; a missing
            // hint is not worth surfacing.
            setIsLast(false)
        }
    }, [method])

    if (!isLast) return null

    return (
        <Badge variant="secondary" className="ml-2 text-[10px] font-normal">
            last used
        </Badge>
    )
}

/**
 * Passkey sign-in.
 *
 * Uses `autoFill` so the browser can satisfy the request from a credential the
 * user already picked in the autofill UI; when it cannot, the explicit
 * `signIn.passkey()` call opens the platform prompt.
 *
 * Only renders when the passkey client plugin is registered, so a deployment
 * without it does not show a button that cannot work.
 */
function PasskeySignInButton() {
    const hasPasskeyPlugin =
        typeof (authClient as { passkey?: unknown }).passkey !== 'undefined'
    const [busy, setBusy] = React.useState(false)
    const [error, setError] = React.useState<string | null>(null)

    if (!hasPasskeyPlugin) return null

    const handleClick = async () => {
        setBusy(true)
        setError(null)
        try {
            const result = await authClient.signIn.passkey({ autoFill: false })

            if (result?.error) {
                // A cancelled prompt is the common case and needs no alarm —
                // the browser already told the user what happened.
                const message = result.error.message ?? 'Passkey sign-in failed'
                if (!/cancel|abort|not allowed/i.test(message)) {
                    setError(message)
                }
                return
            }

            // Full reload, not a client-side push: the session cookie changed,
            // so every cached user-scoped value is stale.
            window.location.href = getPostSignInTarget()
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Passkey sign-in failed'
            if (!/cancel|abort|not allowed/i.test(message)) {
                setError(message)
            }
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="space-y-2">
            <Button
                type="button"
                variant="outline"
                className="h-12 w-full text-base"
                disabled={busy}
                onClick={() => void handleClick()}
            >
                {busy ? <Spinner /> : <Fingerprint className="h-4 w-4" />}
                <span className="ml-2">Sign in with a passkey</span>
                <LastUsedBadge method="passkey" />
            </Button>
            {error && (
                <p role="alert" className="text-destructive text-sm font-medium">
                    {error}
                </p>
            )}
        </div>
    )
}

/**
 * Sign In page.
 *
 * Exported as a PLAIN component rather than `AuthSignin.Route(...)`.
 *
 * `Route` wraps the page in `createPage`, which does `await props.searchParams`
 * before rendering. On a route with no dynamic segments that await is pure
 * overhead, and with Cache Components it is a request-time read: the whole page
 * ends up inside a single Suspense hole, so `signin.html` shipped as an empty
 * shell (no form, no heading) and hydration had to fill in everything.
 *
 * Returning the component directly keeps the form in the static shell. The two
 * places that genuinely need the query string (setup gate, sign-up link) read
 * it without a suspending hook — see `readUrlSearchParam` above.
 */
export default function SignInPage() {
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
                                            <LastUsedBadge method="email" />
                                        </Button>
                                    )}
                                </form.Subscribe>
                            </div>

                            {/* Passkey sign-in. Rendered as an alternative rather than
                                the default: a user without an enrolled passkey would
                                otherwise meet a button that only shows a browser error. */}
                            <PasskeySignInButton />

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
                        <SignUpLink />
                    </p>
                </div>

                {/* Timing Logger */}
                <PageTimingLogger pageName="Sign In" />
            </div>
        </div>
    )
}