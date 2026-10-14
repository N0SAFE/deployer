"use client";

import React, { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { createAuthClientFactory } from "@repo/auth/client";
import { Button } from "@repo/ui/components/shadcn/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/shadcn/card";
import { Input } from "@repo/ui/components/shadcn/input";
import { Label } from "@repo/ui/components/shadcn/label";
import { Alert, AlertDescription } from "@repo/ui/components/shadcn/alert";
import { AlertCircle, Loader2, Shield } from "lucide-react";

/**
 * Login screen for API-served pages that require auth (guarded server-side by
 * the manage-auth middleware). Signs in through the SAME Better Auth server
 * the web app uses (`/api/auth`), then navigates to the console.
 *
 * TanStack Form + @repo/ui — same stack as the web app's sign-in page.
 */
const auth = createAuthClientFactory({ basePath: "/api/auth" });

type LoginViewProps = {
	redirect?: string;
	error?: string | null;
};

export default function LoginView({ redirect = "/manage/web-app", error }: LoginViewProps) {
	const [message, setMessage] = useState<string | null>(error ?? null);

	const form = useForm({
		defaultValues: {
			email: "",
			password: "",
		},
		validators: {
			onChange: ({ value }) => {
				if (!/^\S+@\S+\.\S+$/.test(value.email)) {
					return { fields: { email: "Enter a valid email address" } };
				}
				if (value.password.length < 1) {
					return { fields: { password: "Password is required" } };
				}
				return undefined;
			},
		},
		onSubmit: async ({ value }) => {
			setMessage(null);
			try {
				const res = await auth.signIn.email({ email: value.email, password: value.password });
				if (res.error) {
					setMessage(res.error.message ?? "Invalid credentials");
					return;
				}
				window.location.assign(redirect);
			} catch (err) {
				setMessage(err instanceof Error ? err.message : "Sign-in failed");
			}
		},
	});

	return (
		<div className="flex min-h-[70dvh] items-center justify-center">
			<div className="w-full max-w-96">
				<Card>
					<CardHeader className="space-y-4 text-center">
						<div className="flex justify-center">
							<div className="bg-primary/10 rounded-full p-3">
								<Shield className="h-8 w-8 text-primary" />
							</div>
						</div>
						<div>
							<CardTitle className="text-2xl font-bold">Platform console</CardTitle>
							<CardDescription className="text-base">
								Sign in with your Deployer account to manage this node.
							</CardDescription>
						</div>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								e.stopPropagation();
								void form.handleSubmit();
							}}
							className="space-y-5"
						>
							<form.Field name="email">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="login-email">Email address</Label>
										<Input
											id="login-email"
											type="email"
											placeholder="you@example.com"
											autoComplete="username"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											aria-invalid={field.state.meta.errors.length > 0}
											aria-describedby={field.state.meta.errors.length > 0 ? "login-email-error" : undefined}
										/>
										{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
											<p id="login-email-error" role="alert" className="text-sm font-medium text-destructive">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>

							<form.Field name="password">
								{(field) => (
									<div className="space-y-2">
										<Label htmlFor="login-password">Password</Label>
										<Input
											id="login-password"
											type="password"
											placeholder="••••••••"
											autoComplete="current-password"
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(e) => field.handleChange(e.target.value)}
											aria-invalid={field.state.meta.errors.length > 0}
											aria-describedby={field.state.meta.errors.length > 0 ? "login-password-error" : undefined}
										/>
										{field.state.meta.isTouched && field.state.meta.errors.length > 0 && (
											<p id="login-password-error" role="alert" className="text-sm font-medium text-destructive">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{message !== null && (
								<Alert variant="destructive">
									<AlertCircle className="h-4 w-4" />
									<AlertDescription>{message}</AlertDescription>
								</Alert>
							)}

							<form.Subscribe
								selector={(state) => ({
									canSubmit: state.canSubmit,
									isSubmitting: state.isSubmitting,
								})}
							>
								{({ canSubmit, isSubmitting }) => (
									<Button type="submit" className="w-full" disabled={!canSubmit || isSubmitting}>
										{isSubmitting && <Loader2 className="size-4 animate-spin" />}
										<span className="ml-1.5">{isSubmitting ? "Signing in…" : "Sign in"}</span>
									</Button>
								)}
							</form.Subscribe>
						</form>
					</CardContent>
				</Card>
			</div>
		</div>
	);
}