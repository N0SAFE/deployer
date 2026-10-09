import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'
import { SettingsNav } from './_components/settings-nav'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Settings', 'Account, access, integrations, this node and security — all in one place')

/** Every settings page shares one section nav, so settings are found in one place. */
export default function SettingsLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col gap-6">
			<SettingsNav />
			{children}
		</div>
	)
}
