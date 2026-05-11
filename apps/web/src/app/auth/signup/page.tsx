/* eslint-disable @typescript-eslint/no-unnecessary-condition */
'use client'

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
import { signupSchema } from './schema'
import { AuthSignup, AuthSignin, Setup } from '@/routes'
import { UserPlus } from 'lucide-react'
import { authClient } from '@/lib/auth'
import { useSetupStatus } from '@/domains/setup/hooks'
import { useRouter } from 'next/navigation'
import { zodFieldErrors } from '@/lib/forms/zod-field-errors'

// Use the Route wrapper to get type-safe, Suspense-wrapped search params
export default AuthSignup.Route(({ searchParams }) => {
    const [isLoading, setIsLoading] = React.useState<boolean>(false)
    const [error, setError] = React.useState<string>('')
    const [success, setSuccess] = React.useState<string>('')
    const [fieldErrors, setFieldErrors] = React.useState<Partial<Record<keyof z.infer<typeof signupSchema>, string>>>({})
    const router = useRouter()
    const setupStatus = useSetupStatus()

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

    if (setupStatus.data?.needsSetup) {
        return (
            <div className="flex flex-1 items-center justify-center">
                <div className="text-muted-foreground flex items-center gap-2 text-sm">
                    <Spinner /> Redirecting to setup...
                </div>
            </div>
        )
    }

    const form = useForm({
        defaultValues: {
            name: '',
            email: '',
            password: '',
            confirmPassword: '',
        },
        onSubmit: async ({ value }) => {
            setError('')
            setSuccess('')
            setFieldErrors({})

            const parsed = signupSchema.safeParse(value)
            if (!parsed.success) {
                setFieldErrors(zodFieldErrors(parsed.error))
                return
            }

            setIsLoading(true)

            const res = await authClient.signUp.email({
                email: parsed.data.email,
                password: parsed.data.password,
                name: parsed.data.name,
            })

            if (res?.error) {
                const errorMessage = res.error.message ?? 'Registration failed'
                setError(errorMessage)
                setIsLoading(false)
                return
            }

            setSuccess('Account created successfully! Redirecting...')
            setTimeout(() => {
                setIsLoading(false)
                void redirect(searchParams.redirectTo ?? searchParams.callbackUrl ?? '/')
            }, 1500)
        },
    })

    const clearFieldError = React.useCallback((key: keyof z.infer<typeof signupSchema>) => {
        setFieldErrors((previous) => {
            if (!previous[key]) {
                return previous
            }

            const next = { ...previous }
            delete next[key]
            return next
        })
    }, [])

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
                                    void form.handleSubmit()
                                }}
                                className="space-y-6"
                            >
                                <div className="space-y-4">
                                    <form.Field name="name">
                                        {(field) => (
                                            <div className="space-y-2">
                                                <label htmlFor="name" className="text-sm font-medium leading-none">
                                                    Full Name
                                                </label>
                                                <Input
                                                    placeholder="John Doe"
                                                    id="name"
                                                    type="text"
                                                    className="h-12"
                                                    value={field.state.value}
                                                    onChange={(event) => {
                                                        clearFieldError('name')
                                                        field.handleChange(event.target.value)
                                                    }}
                                                />
                                                {fieldErrors.name ? (
                                                    <p className="text-sm font-medium text-destructive">{fieldErrors.name}</p>
                                                ) : null}
                                            </div>
                                        )}
                                    </form.Field>

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

                                    <form.Field name="confirmPassword">
                                        {(field) => (
                                            <div className="space-y-2">
                                                <label htmlFor="confirmPassword" className="text-sm font-medium leading-none">
                                                    Confirm Password
                                                </label>
                                                <Input
                                                    id="confirmPassword"
                                                    type="password"
                                                    className="h-12"
                                                    value={field.state.value}
                                                    onChange={(event) => {
                                                        clearFieldError('confirmPassword')
                                                        field.handleChange(event.target.value)
                                                    }}
                                                />
                                                {fieldErrors.confirmPassword ? (
                                                    <p className="text-sm font-medium text-destructive">{fieldErrors.confirmPassword}</p>
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

                                    {success && (
                                        <Alert>
                                            <AlertDescription>
                                                {success}
                                            </AlertDescription>
                                        </Alert>
                                    )}

                                    <Button
                                        disabled={isLoading}
                                        type="submit"
                                        className="h-12 w-full text-base"
                                    >
                                        {isLoading && <Spinner />}
                                        Create Account
                                    </Button>
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
