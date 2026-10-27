import type { ReactNode } from 'react'

/** Titled card grouping related fields inside a wizard step. */
export function Section({ title, description, icon, children }: {
  title: string
  description?: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-3 rounded-lg border bg-background/40 p-4">
      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-semibold">
          {icon}{title}
        </h4>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}
