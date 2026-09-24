import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/**
 * Account route layout.
 *
 * Metadata must come from a SERVER component. `page.tsx` is a client component
 * (session hooks + profile forms), and exporting `metadata` from a file marked
 * `'use client'` is a hard Next.js error — so the title lives here instead.
 */
export const metadata: Metadata = {
    title: 'Account',
    description: 'Your Deployer account',
}

export default function AccountLayout({ children }: { children: ReactNode }) {
    return children
}
