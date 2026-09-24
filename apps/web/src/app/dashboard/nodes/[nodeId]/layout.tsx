import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Node', 'Live resources, services and tasks on one node')

export default function NodeDetailLayout({ children }: { children: ReactNode }) {
	return children
}
