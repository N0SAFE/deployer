import { ExternalLink } from 'lucide-react'

import type { ReactNode } from 'react'

/** "Where do I get this?" — numbered steps plus a link to the provider's own page. */
export function FieldHelp({
    href,
    linkLabel,
    children,
}: {
    href: string
    linkLabel: string
    children: ReactNode
}) {
    return (
        <div className="bg-muted/30 rounded-lg border p-3 text-sm">
            <div className="text-muted-foreground">{children}</div>
            <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary mt-2 inline-flex items-center gap-1 font-medium hover:underline"
            >
                {linkLabel}
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
            </a>
        </div>
    )
}

/** Inline field error, tied to its input through `id`. */
export function FieldErrorText({
    id,
    errors,
}: {
    id: string
    errors: readonly unknown[]
}) {
    const messages = errors
        .map((e) =>
            typeof e === 'string'
                ? e
                : e && typeof e === 'object' && 'message' in e
                  ? String(e.message)
                  : ''
        )
        .filter(Boolean)
    if (messages.length === 0) return null
    return (
        <p id={id} role="alert" className="text-destructive text-sm">
            {messages.join(', ')}
        </p>
    )
}
