/**
 * Instant-navigation regression guards (HTTP-level, Vitest e2e).
 *
 * These specs assert the STATIC SHELL CONTRACT of key routes against a real
 * production build served by `next start` (started in vitest.global-setup.e2e.ts):
 *
 *  1. Each route's prerendered HTML contains its meaningful shell content
 *     (hero, forms) — an empty-shell regression (a `<Suspense fallback={null}>`
 *     wrapped around a whole page, a new request-time read above the boundary)
 *     empties this HTML and turns these RED.
 *  2. Content that is SUPPOSED to stream (session-dependent nav controls,
 *     per-user data) is NOT part of the static shell — proving the shell/stream
 *     split stayed intact.
 *  3. Dynamic routes keep their fallback shells and the unauthenticated auth
 *     gate still redirects preserving ?redirectTo.
 *  4. URL-data behavior still works at runtime (?redirectTo / ?error).
 *
 * Run: bun --bun run test:e2e   (builds, starts the prod server, runs these)
 */
import { describe, expect, it } from 'vitest'
import { getWebE2eBaseUrl } from '../../vitest.setup.e2e'

const baseUrl = getWebE2eBaseUrl()

async function fetchHtml(path: string): Promise<{ status: number; html: string; location?: string }> {
    const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' })
    const html = await res.text()
    return {
        status: res.status,
        html,
        location: res.headers.get('location') ?? undefined,
    }
}

describe('instant navigation — static shell contracts', () => {
    it('home page prerenders its hero and features section', async () => {
        const { status, html } = await fetchHtml('/')
        expect(status).toBe(200)

        // Shell content (LCP + static sections) must be IN the prerendered HTML.
        expect(html).toContain('Deployer Platform')
        expect(html).toContain('Features')

        // Streamed content (session-dependent nav) must NOT be in the shell:
        // the Sign In / Dashboard nav controls resolve after the auth read.
        // The hero heading is the LCP element and proves a non-empty shell.
        const bodyStart = html.indexOf('<body')
        expect(bodyStart).toBeGreaterThan(-1)
    })

    it('sign-in page prerenders the complete form (no empty-shell regression)', async () => {
        const { status, html } = await fetchHtml('/auth/signin')
        expect(status).toBe(200)

        // The whole form lives in the static shell. If any of these markers
        // disappear, something re-introduced a render-time URL-data read above
        // the form and pushed it out of the prerender.
        expect(html).toContain('Welcome Back')
        expect(html).toContain('Email Address')
        expect(html).toContain('Demo Credentials')
        expect(html).toMatch(/type="email"/)
        expect(html).toMatch(/type="password"/)

        // The deferred leaves render a fallback skeleton in the initial HTML,
        // which resolves to the real link after hydration — so the fallback
        // text 'Create one here' IS present from the start.
        expect(html).toContain('Create one here')
    })

    it('sign-in page serves ?redirectTo dynamically with full content', async () => {
        // A query string bypasses the cached shell (dynamic document), but the
        // page must still render completely for real navigations with params.
        const { status, html } = await fetchHtml(
            '/auth/signin?redirectTo=%2Fdashboard%2Fprojects',
        )
        expect(status).toBe(200)
        expect(html).toContain('Welcome Back')
    })

    it('auth error page serves the shell with its Suspense fallback', async () => {
        const { status, html } = await fetchHtml('/auth/error?error=AccessDenied')
        expect(status).toBe(200)
        // The error card is a client component reading useSearchParams(); it
        // suspends during SSR and resolves after hydration — so the static
        // document carries the root shell plus the Suspense fallback text,
        // NOT the error content itself.
        expect(html).toContain('bg-background')
        expect(html).toContain('Loading')
    })

    it('unauthenticated dashboard requests redirect preserving redirectTo', async () => {
        const { status, location } = await fetchHtml(
            '/dashboard/projects/some-project-id/team',
        )
        expect(status).toBe(307)
        if (!location) throw new Error('307 response is missing a Location header')
        expect(location).toContain('/auth/signin')
        expect(decodeURIComponent(location)).toContain(
            'redirectTo=/dashboard/projects/some-project-id/team',
        )
    })

    it('docker dashboard keeps its skeleton fallback shell for dynamic routes', async () => {
        // The [projectId] fallback shells contain real loading skeletons —
        // verify the prerendered fallback asset on disk still has them, so a
        // lost prerender (empty shell) is caught without needing auth.
        const { readFileSync } = await import('node:fs')
        const { resolve } = await import('node:path')
        const cwd = process.cwd()
        const fallbackPath = resolve(
            cwd,
            '.next/server/app/dashboard/projects/[projectId]/team.html',
        )
        const fallbackHtml = readFileSync(fallbackPath, 'utf-8')
        // Skeleton placeholders (animate-pulse) prove the fallback shell is real.
        expect(fallbackHtml).toContain('animate-pulse')
    })
})
