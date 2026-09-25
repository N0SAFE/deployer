import React from "react";
import type { LayoutProps } from "@nestjs-ssr/react";

/**
 * Root layout shared by every SSR page served from the API (the
 * `@nestjs-ssr/react` page system). Renders the same design language as the
 * web app via `@repo/ui` + the shared Tailwind globals.
 */
export default function RootLayout({ children, layoutProps }: LayoutProps<{ title?: string }>) {
	return (
		<div className="min-h-dvh bg-background text-foreground antialiased">
			<header className="border-b border-border bg-card/60">
				<div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-6 py-3">
					<a href="/manage/web-app" className="flex items-center gap-2 text-sm font-semibold">
						<span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-xs">
							◆
						</span>
						<span>Deployer Platform</span>
					</a>
					<span className="text-xs text-muted-foreground">API-served console</span>
				</div>
			</header>
			<main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
		</div>
	);
}