import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Security', 'Mesh trust keyring and strict mode')

export default function SettingsSecurityLayout({ children }: { children: ReactNode }) {
	return children
}
