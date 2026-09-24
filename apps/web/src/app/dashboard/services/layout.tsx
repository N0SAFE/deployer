import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Services', 'Health and lifecycle status across all services')

export default function ServicesLayout({ children }: { children: ReactNode }) {
	return children
}
