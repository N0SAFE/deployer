/* eslint-disable @typescript-eslint/no-unnecessary-condition */
'use client'

// Using typed routing: replace raw next/link with declarative routes

import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Alert, AlertDescription } from '@repo/ui/components/shadcn/alert'
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@repo/ui/components/shadcn/card'
import { z } from 'zod'
import { useForm } from '@tanstack/react-form'
import React from 'react'
import redirect from '@/actions/redirect'
import { AlertCircle, Spinner } from '@repo/ui/components/atomics/atoms/Icon'
import { loginSchema } from './schema'
import { AuthSignin, AuthSignup, Setup } from '@/routes'
import { Shield } from 'lucide-react'
import { authClient } from '@/lib/auth'
import { PageTimingLogger } from '@/lib/timing'
import { useSetupState } from '@/domains/setup/hooks'
import { useRouter } from 'next/navigation'
import { zodFieldErrors } from '@/lib/forms/zod-field-errors'

// Use the Route wrapper to get type-safe, Suspense-wrapped search params
export default AuthSignin.Route(({ searchParams }) => {
    // ─── Hooks (must always be called in the same order — no early return before) ───
    const [isLoading, setIsLoading] = React.useState<boolean>(false)
    const [error, setError] = React.useState<string>('')
    const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<keyof z.infer<typeof loginSchema>, string>>>({})
    const router = useRouter()
    const setupStatus = useSetupState()

    const form = useForm({
        defaultValues: {
            email: '',
            password: '',
        },
        onSubmit: async ({ value }) => {
            setError('')
            setFieldErrors({})

            const parsed = loginSchema.safeParse(value)
            if (!parsed.success) {
                setFieldErrors(zodFieldErrors(parsed.error))
                return
            }

            setIsLoading(true)
            const res = await authClient.signIn.email({
                email: parsed.data.email,
                password: parsed.data.password,
            })

            if (res?.error) {
                const errorMessage = res.error.message ?? 'Authentication failed'
                setError(errorMessage)
                setIsLoading(false)
                return
            }

            setIsLoading(false)
            console.log(searchParams)
            void redirect(searchParams.redirectTo ?? searchParams.callbackUrl ?? '/')
        },
    })

    const clearFieldError = React.useCallback((key: keyof z.infer<typeof loginSchema>) => {
        setFieldErrors((previous) => {
            if (!previous[key]) {
                return previous
            }

            const next = { ...previous }
            delete next[key]
            return next
        })
    }, [])

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
                                    void form.handleSubmit()
                                }}
                                className="space-y-6"
                            >
                                <div className="space-y-4">
                                    <form.Field name="email">
                                        {(field) => (
                                            <div className="space-y-2">
                                                <label htmlFor="email" className="text-sm font-medium leading-none">
                                                    Email Address
                                                </label>
                                                <Input
                                                    placeholder="john@example.com"
                                                    id="email"
                                                    type="email"
                                                    className="h-12"
                                                    autoComplete="username webauthn"
                                                    value={field.state.value}
                                                    onChange={(event) => {
                                                        clearFieldError('email')
                                                        field.handleChange(event.target.value)
                                                    }}
                                                />
                                                {fieldErrors.email ? (
                                                    <p className="text-sm font-medium text-destructive">{fieldErrors.email}</p>
                                                ) : null}
                                            </div>
                                        )}
                                    </form.Field>

                                    <form.Field name="password">
                                        {(field) => (
                                            <div className="space-y-2">
                                                <label htmlFor="password" className="text-sm font-medium leading-none">
                                                    Password
                                                </label>
                                                <Input
                                                    id="password"
                                                    type="password"
                                                    className="h-12"
                                                    autoComplete="current-password webauthn"
                                                    value={field.state.value}
                                                    onChange={(event) => {
                                                        clearFieldError('password')
                                                        field.handleChange(event.target.value)
                                                    }}
                                                />
                                                {fieldErrors.password ? (
                                                    <p className="text-sm font-medium text-destructive">{fieldErrors.password}</p>
                                                ) : null}
                                            </div>
                                        )}
                                    </form.Field>

                                    {error && (
                                        <Alert variant="destructive">
                                            <AlertCircle className="h-4 w-4" />
                                            <AlertDescription>
                                                {error}
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    <div className="space-y-3">
                                        <Button
                                            disabled={isLoading}
                                            type="submit"
                                            className="h-12 w-full text-base"
                                        >
                                            {isLoading && <Spinner />}
                                            Sign In with Email
                                        </Button>
                                    </div>
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
                        <AuthSignup.Link
                            search={{
                                redirectTo: searchParams.redirectTo,
                                callbackUrl: searchParams.callbackUrl,
                            }}
                            className="text-primary hover:underline"
                        >
                            Create one here
                        </AuthSignup.Link>
                    </p>
                </div>
                
                {/* Timing Logger */}
                <PageTimingLogger pageName="Sign In" />
            </div>
        </div>
    )
})
