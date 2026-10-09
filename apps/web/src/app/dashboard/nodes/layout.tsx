import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'
import { NodesNav } from './_components/nodes-nav'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata(
	'Nodes',
	'Every node in the mesh, with live capacity and allocation',
)

/**
 * Overview, Capacity & admissions and Diagnostics share one tab strip. The strip
 * hides itself on a node's own workspace (`[nodeId]`), which has its own header.
 */
export default function NodesLayout({ children }: { children: ReactNode }) {
	return (
		<div className="flex flex-col gap-6">
			<NodesNav />
			{children}
		</div>
	)
}
