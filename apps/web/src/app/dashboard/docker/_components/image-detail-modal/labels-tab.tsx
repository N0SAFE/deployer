'use client'

import { DockerCopyButton } from '../docker-copy-button'

export function ImageLabelsTab({ labels }: { labels: Readonly<Record<string, string>> }) {
  const entries = Object.entries(labels)
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">This image carries no labels. Labels are metadata set at build time (maintainer, version, source repository).</p>
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 text-sm">
      {entries.map(([key, value]) => (
        <div key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded border p-3">
          <span className="break-all text-muted-foreground">{key}</span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <code className="break-all font-mono text-xs">{value}</code>
            <DockerCopyButton value={value} label={`label ${key}`} />
          </span>
        </div>
      ))}
    </div>
  )
}
