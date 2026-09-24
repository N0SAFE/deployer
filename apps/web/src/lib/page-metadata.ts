import type { Metadata } from 'next'

/**
 * `pageMetadata` — build a route's `Metadata` for a co-located `layout.tsx`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Most console pages are CLIENT components (they use hooks, forms, streams).
 * Next.js forbids exporting `metadata` from a file marked `'use client'`, so a
 * page's title cannot live next to the page — it belongs to the nearest SERVER
 * layout. Every such layout has the same shape:
 *
 *   export const metadata = pageMetadata('Nodes', 'Every node in the mesh')
 *   export default function Layout({ children }: { children: ReactNode }) {
 *     return children
 *   }
 *
 * The root layout supplies the `%s · Deployer` template, so the title passed
 * here is the bare page name ("Nodes") rather than the full document title.
 */
export function pageMetadata(title: string, description?: string): Metadata {
	return description === undefined ? { title } : { title, description }
}
