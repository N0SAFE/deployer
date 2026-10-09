'use client'

/**
 * Seeded demo account. Rendered ONLY when `devConveniencesEnabled()` is true
 * (never in a production build) — see `../../_utils/dev-only.ts`.
 */
export function DevDemoCredentials() {
  return (
    <div className="bg-muted/50 rounded-lg border border-dashed p-4 text-sm">
      <p className="text-foreground mb-1 font-medium">Development only: seeded admin</p>
      <p className="text-muted-foreground">
        Email <code className="font-mono">admin@admin.com</code> · password{' '}
        <code className="font-mono">adminadmin</code>
      </p>
    </div>
  )
}
