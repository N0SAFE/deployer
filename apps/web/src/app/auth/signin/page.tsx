'use client'


// Using typed routing: replace raw next/link with declarative routes

import { getErrorMessage } from "@/lib/orpc/typed-errors";
import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Alert, AlertDescription } from '@deployer/ui/components/shadcn/alert'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@deployer/ui/components/shadcn/card'
import { useForm } from '@tanstack/react-form'
import React, { Suspense } from 'react'
import redirect from '@/actions/redirect'
import { AlertCircle, Spinner } from '@deployer/ui/components/atomics/atoms/Icon'
import { loginSchema } from './schema'
import { AuthSignup } from '@/routes'
import { Rocket } from 'lucide-react'
import { authClient } from '@/lib/auth'
import { PageTimingLogger } from '@/lib/timing'
import { useSetupState } from '@/domains/setup/hooks'
import { setupDestinationUrl } from '@/lib/setup-url'
import { useRouter } from 'next/navigation'
import { PasswordInput } from '../_components/password-input'
import { devConveniencesEnabled, signInErrorHint } from '../_utils/dev-only'
import { PasskeySignInButton, LastUsedBadge } from './_components/passkey-button'
import { DevDemoCredentials } from './_components/dev-demo-credentials'
import { getPostSignInTarget, readUrlSearchParam } from './_utils/url'

/** Compile-time constant in production bundles (see `dev-only.ts`). */
const DEV_CONVENIENCES = devConveniencesEnabled()

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
            <div className="w-full max-w-md space-y-6">
                <Card>
                    <CardHeader className="space-y-4 text-center">
                        <div className="flex justify-center">
                            <div className="bg-primary/10 rounded-full p-3">
                                <Rocket className="text-primary h-8 w-8" aria-hidden />
                            </div>
                        </div>
                        <div>
                            <CardTitle className="text-2xl font-bold">
                                Sign in to Deployer
                            </CardTitle>
                            <CardDescription className="text-base">
                                Use your account to manage the projects, services and
                                nodes deployed on this server.
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
                                            <Label htmlFor="email">Email address</Label>
                                            <Input
                                                placeholder="you@example.com"
                                                id="email"
                                                autoFocus
                                                type="email"
                                                className="h-12"
                                                autoComplete="username"
                                                value={field.state.value}
                                                onBlur={field.handleBlur}
                                                onChange={(event) => { field.handleChange(event.target.value); }}
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
                                            <PasswordInput
                                                id="password"
                                                className="h-12"
                                                autoComplete="current-password"
                                                value={field.state.value}
                                                onBlur={field.handleBlur}
                                                onChange={(event) => { field.handleChange(event.target.value); }}
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
                                            <p>{authError}</p>
                                            {signInErrorHint(authError) ? (
                                                <p className="mt-1">{signInErrorHint(authError)}</p>
                                            ) : null}
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
                                            {isSubmitting ? 'Signing in…' : 'Sign in with email'}
                                            <LastUsedBadge method="email" />
                                        </Button>
                                    )}
                                </form.Subscribe>
                            </div>

                            {/* Passkey sign-in. Rendered as an alternative rather than
                                the default: a user without an enrolled passkey would
                                otherwise meet a button that only shows a browser error. */}
                            <PasskeySignInButton />

                            {DEV_CONVENIENCES ? <DevDemoCredentials /> : null}
                        </form>
                    </CardContent>
                </Card>
                {DEV_CONVENIENCES ? (
                    <div className="text-muted-foreground text-center text-sm">
                        <p>
                            Don&apos;t have an account?{' '}
                            <SignUpLink />
                        </p>
                    </div>
                ) : (
                    <p className="text-muted-foreground text-center text-sm">
                        Accounts are created by an administrator of this server. Ask yours for an invitation.
                    </p>
                )}

                {/* Timing Logger */}
                <PageTimingLogger pageName="Sign In" />
            </div>
        </div>
    )
}