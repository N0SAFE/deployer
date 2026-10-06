import type { ReactNode } from 'react'
import { pageMetadata } from '@/lib/page-metadata'

// Title lives here, not in `page.tsx`: the page is a client component and
// Next.js forbids a `metadata` export from a `'use client'` file.
export const metadata = pageMetadata('Edge & Ingress', 'How the internet reaches this stack: DNS or a Cloudflare tunnel')

export default function AdminEdgeLayout({ children }: { children: ReactNode }) {
  return children
}
