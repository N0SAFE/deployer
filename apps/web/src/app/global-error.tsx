'use client'

import { getErrorMessage } from "@/lib/orpc/typed-errors";
import * as React from 'react'
import { logger } from '@repo/logger'

/**
 * Global error boundary — the last line of defence.
 *
 * This REPLACES the root layout, so the app's stylesheet, fonts and theme
 * provider may never have mounted. Everything here is therefore inline and
 * self-contained: literal values from the shared token sheet
 * (`@repo/ui/styles/globals.css`, brand violet `oklch(0.5600 0.2250 304.00)`
 * plus the light/dark surfaces), no Tailwind classes, and a
 * `prefers-color-scheme` query so it stays readable either way.
 *
 * Keep this file dependency-free. If an import here throws, the user gets the
 * browser's raw error page and every part of the design system is lost.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  React.useEffect(() => {
    // Log the error to an error reporting service
    logger.error(error)
  }, [error])

  return (
    <html lang="en">
      <head>
        <title>Deployer — application error</title>
        <style
          // Values mirror the design tokens in the shared UI stylesheet
          // (packages/ui/base/src/styles/globals.css).
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --ge-bg: oklch(0.9400 0.0220 295.00);
                --ge-fg: oklch(0.1950 0.0520 292.00);
                --ge-muted: oklch(0.4700 0.0450 292.00);
                --ge-border: oklch(0.7000 0.0550 293.00);
                --ge-danger: oklch(0.5300 0.2000 22.00);
                --ge-danger-soft: color-mix(in oklch, oklch(0.5300 0.2000 22.00) 12%, transparent);
                --ge-primary: oklch(0.5600 0.2250 304.00);
                --ge-on-primary: oklch(0.9750 0.0100 300.00);
              }
              @media (prefers-color-scheme: dark) {
                :root {
                  --ge-bg: oklch(0.0680 0.0420 294.00);
                  --ge-fg: oklch(0.9400 0.0200 298.00);
                  --ge-muted: oklch(0.7300 0.0340 296.00);
                  --ge-border: oklch(0.1800 0.0450 294.00);
                  --ge-danger: oklch(0.7250 0.1550 20.00);
                  --ge-danger-soft: color-mix(in oklch, oklch(0.7250 0.1550 20.00) 18%, transparent);
                  --ge-primary: oklch(0.7350 0.2100 305.00);
                  --ge-on-primary: oklch(0.1200 0.0350 292.00);
                }
              }
              * { box-sizing: border-box; }
              body.ge {
                margin: 0; min-height: 100dvh; display: flex;
                align-items: center; justify-content: center; padding: 2rem;
                background: var(--ge-bg); color: var(--ge-fg);
                font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
                -webkit-font-smoothing: antialiased;
              }
              .ge-panel { max-width: 30rem; text-align: center; }
              .ge-disc {
                width: 3.5rem; height: 3.5rem; margin: 0 auto 1.25rem;
                display: flex; align-items: center; justify-content: center;
                border-radius: 9999px; background: var(--ge-danger-soft); color: var(--ge-danger);
              }
              .ge-title { margin: 0 0 0.375rem; font-size: 1.125rem; font-weight: 600; letter-spacing: -0.01em; }
              .ge-body { margin: 0; font-size: 0.875rem; line-height: 1.5; color: var(--ge-muted); }
              .ge-actions { margin-top: 1.5rem; display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; }
              .ge-btn {
                font: inherit; font-size: 0.875rem; font-weight: 500;
                padding: 0.5rem 1rem; border-radius: 0.5rem; cursor: pointer;
                border: 1px solid var(--ge-border); background: transparent; color: var(--ge-fg);
              }
              .ge-btn--primary { background: var(--ge-primary); border-color: transparent; color: var(--ge-on-primary); }
              .ge-btn:hover { opacity: 0.9; }
              .ge-btn:focus-visible { outline: 2px solid var(--ge-primary); outline-offset: 2px; }
              .ge-ref { margin-top: 1.25rem; font-size: 0.75rem; color: var(--ge-muted); }
              .ge-ref code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
            `,
          }}
        />
      </head>
      <body className="ge">
        <div className="ge-panel">
          <div className="ge-disc" aria-hidden="true">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h1 className="ge-title">Deployer couldn’t start</h1>
          <p className="ge-body">
            {getErrorMessage(error, 'The application shell failed to render.')}{' '}
            Reloading usually clears it — if it keeps happening, check the API
            health endpoint and the server logs.
          </p>
          <div className="ge-actions">
            <button type="button" className="ge-btn ge-btn--primary" onClick={reset}>
              Try again
            </button>
            <button
              type="button"
              className="ge-btn"
              onClick={() => {
                window.location.reload()
              }}
            >
              Hard reload
            </button>
          </div>
          {error.digest ? (
            <p className="ge-ref">
              Reference: <code>{error.digest}</code>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  )
}
