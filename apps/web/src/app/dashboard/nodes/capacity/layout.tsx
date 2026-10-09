import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Capacity & admissions', 'Per-node capacity, allocations and pending admission requests')

export default function NodesCapacityLayout({ children }: { children: ReactNode }) {
	return children
}
