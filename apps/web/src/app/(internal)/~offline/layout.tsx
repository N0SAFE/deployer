import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/**
 * Offline route layout.
 *
 * Metadata must come from a SERVER component. The page itself is a client
 * component (it renders interactive "retry"/"reload" controls), and exporting
 * `metadata` from a file marked `'use client'` is a hard Next.js error — so the
 * title lives here, one level above the client page.
 */
export const metadata: Metadata = {
    title: 'Offline',
    description: 'The platform is temporarily offline',
}

export default function OfflineLayout({ children }: { children: ReactNode }) {
    return children
}
