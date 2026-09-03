/* eslint-disable @typescript-eslint/no-unnecessary-condition */
'use client'

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
import React from 'react'
import redirect from '@/actions/redirect'
import { AlertCircle, Spinner } from '@repo/ui/components/atomics/atoms/Icon'
import { signupSchema } from './schema'
import { AuthSignup, AuthSignin, Setup } from '@/routes'
import { UserPlus } from 'lucide-react'
import { authClient } from '@/lib/auth'
import { useSetupState } from '@/domains/setup/hooks'
import { useRouter } from 'next/navigation'

// Use the Route wrapper to get type-safe, Suspense-wrapped search params
export default AuthSignup.Route(({ searchParams }) => {
    // ─── Hooks (must always be called in the same order — no early return before) ───
    const [authError, setAuthError] = React.useState<string | null>(null)
    const [success, setSuccess] = React.useState<string | null>(null)
    const router = useRouter()
    const setupStatus = useSetupState()

    const form = useForm({
        defaultValues: {
            name: '',
            email: '',
            password: '',
            confirmPassword: '',
        },
        // Native TanStack Form validation: zod schema runs as fields change
        // AND on submit; issues land in each field's `meta.errors` (the
        // confirmPassword `.refine()` path maps to its own field too).
        validators: {
            onChange: signupSchema,
        },
        onSubmit: async ({ value }) => {
            setAuthError(null)
            setSuccess(null)

            try {
                const res = await authClient.signUp.email({
                    email: value.email,
                    password: value.password,
                    name: value.name,
                })

                if (res?.error) {
                    setAuthError(res.error.message ?? 'Registration failed')
                    return
                }
            } catch (error) {
                // Network failure / unreachable API. Without this catch the
                // rejection was unhandled and `isSubmitting` stayed true,
                // leaving the submit button disabled forever.
                setAuthError(
getErrorMessage(error, 'Unable to reach the authentication service'),
                )
                return
            }

            setSuccess('Account created successfully! Redirecting...')
            setTimeout(() => {
                void redirect(searchParams.redirectTo ?? searchParams.callbackUrl ?? '/')
            }, 1500)
        },
    })

    React.useEffect(() => {
        if (setupStatus.data?.needsSetup) {
            router.replace(
                Setup(
                    {},
                    {
                        redirectTo: searchParams.redirectTo ?? searchParams.callbackUrl,
                    }
                )
            )
        }
    }, [setupStatus.data, router, searchParams.callbackUrl, searchParams.redirectTo])

    // ─── Early return only happens AFTER every hook above has been called ───
    if (setupStatus.data?.needsSetup) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Spinner /> Redirecting to setup...
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-md space-y-8">
                <Card>
                    <CardHeader className="space-y-4 text-center">
                        <div className="flex justify-center">
                            <div className="bg-primary/10 rounded-full p-3">
                                <UserPlus className="text-primary h-8 w-8" />
                            </div>
                        </div>
                        <div>
                            <CardTitle className="text-2xl font-bold">
                                Create Account
                            </CardTitle>
                            <CardDescription className="text-base">
                                Sign up to get started with the NestJS
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
                                <form.Field name="name">
                                    {(field) => (
                                        <div className="space-y-2">
                                            <Label htmlFor="name">Full Name</Label>
                                            <Input
                                                placeholder="John Doe"
                                                id="name"
                                                type="text"
                                                className="h-12"
                                                autoComplete="name"
                                                value={field.state.value}
                                                onBlur={field.handleBlur}
                                                onChange={(event) => field.handleChange(event.target.value)}
                                                aria-invalid={field.state.meta.errors.length > 0}
                                                aria-describedby={field.state.meta.errors.length > 0 ? 'name-error' : undefined}
                                            />
                                            {field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
                                                <p id="name-error" role="alert" className="text-sm font-medium text-destructive">
                                                    {field.state.meta.errors[0]?.message}
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </form.Field>

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
                                                autoComplete="new-password"
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

                                <form.Field name="confirmPassword">
                                    {(field) => (
                                        <div className="space-y-2">
                                            <Label htmlFor="confirmPassword">Confirm Password</Label>
                                            <Input
                                                id="confirmPassword"
                                                type="password"
                                                className="h-12"
                                                autoComplete="new-password"
                                                value={field.state.value}
                                                onBlur={field.handleBlur}
                                                onChange={(event) => field.handleChange(event.target.value)}
                                                aria-invalid={field.state.meta.errors.length > 0}
                                                aria-describedby={field.state.meta.errors.length > 0 ? 'confirmPassword-error' : undefined}
                                            />
                                            {field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
                                                <p id="confirmPassword-error" role="alert" className="text-sm font-medium text-destructive">
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

                                {success && (
                                    <Alert>
                                        <AlertDescription>
                                            {success}
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
                                            Create Account
                                        </Button>
                                    )}
                                </form.Subscribe>
                            </div>
                        </form>
                    </CardContent>
                </Card>
                <div className="text-muted-foreground text-center text-sm">
                    <p>
                        Already have an account?{' '}
                        <AuthSignin.Link
                            search={{
                                redirectTo: searchParams.redirectTo,
                                callbackUrl: searchParams.callbackUrl,
                            }}
                            className="text-primary hover:underline"
                        >
                            Sign in here
                        </AuthSignin.Link>
                    </p>
                </div>
            </div>
        </div>
    )
})
