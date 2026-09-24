import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Logs', 'Stream container logs, filtered by source')

export default function DockerLogsLayout({ children }: { children: ReactNode }) {
	return children
}
