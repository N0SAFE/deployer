import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'
import { NetworkNav } from './_components/network-nav'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Network', 'How the stack is reached, and the mesh it runs on')

/**
 * Every networking page shares one section nav, so the planes read as ONE system
 * — lanes and edge (how clients reach Traefik), the mesh (how nodes reach each
 * other), DNS (where names point) and the domains riding on top — instead of
 * pages scattered across the dashboard.
 */
export default function NetworkLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col gap-6">
			<NetworkNav />
			{children}
		</div>
	)
}
