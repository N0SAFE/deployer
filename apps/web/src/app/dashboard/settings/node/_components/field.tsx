import type { ReactNode } from 'react'

/** A read-only labelled value tile used in the node configuration summary. */
export function ValueTile({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1 rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

/** Heading for a titled group of settings on a page. */
export function SettingsSection({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}
