import { pageMetadata } from '@/lib/page-metadata'

import type { ReactNode } from 'react'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata(
    'Peer diagnostics',
    'Control-mesh peers, sessions, route planner and decisions'
)

export default function NodesDiagnosticsLayout({
    children,
}: {
    children: ReactNode
}) {
    return children
}
