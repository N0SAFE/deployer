import type { ReactNode } from 'react'

export function sanitizeContainerLogMessage(message: string): string {
  const timestampIndex = message.search(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/u)
  const withoutDockerPrefix = timestampIndex > 0 ? message.slice(timestampIndex) : message

  return withoutDockerPrefix.replace(/^[\u0000-\u001f\u007f-\u009f]+/u, '')
}

export function renderHighlightedLogMessage(text: string, normalizedSearchTerm: string): ReactNode {
  if (!normalizedSearchTerm) {
    return text
  }

  const escapedSearch = normalizedSearchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escapedSearch})`, 'ig')
  const segments = text.split(regex)

  return segments.map((segment, index) => {
    const matches = segment.toLowerCase() === normalizedSearchTerm
    if (!matches) {
      return <span key={`logs-segment-${String(index)}`}>{segment}</span>
    }

    return (
      <mark key={`logs-mark-${String(index)}`} className="rounded-sm bg-amber-300/30 px-0.5 text-amber-100">
        {segment}
      </mark>
    )
  })
}
