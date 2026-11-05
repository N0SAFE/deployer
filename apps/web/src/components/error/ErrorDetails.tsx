'use client'

import { cn } from '@/lib/utils'

/**
 * ErrorDetails — the development-only error inspector.
 *
 * The block is identical everywhere an error can surface (default, feature and
 * query fallbacks), so it lives here once instead of being copy-pasted with
 * slightly different greys each time. Renders NOTHING in production: an
 * operator should see a recoverable message, never a stack trace.
 */
export function ErrorDetails({
    error,
    feature,
    className,
}: {
    error: Error
    /** Optional feature/context label, shown above the message. */
    feature?: string
    className?: string
}) {
    if (process.env.NODE_ENV !== 'development') return null

    return (
        <div
            className={cn(
                'bg-card/60 ring-border/60 rounded-xl p-4 text-left ring-1',
                className
            )}
        >
            <p className="text-foreground mb-2 text-sm font-medium">
                Error details (development)
            </p>
            {feature ? (
                <p className="text-muted-foreground mb-1 text-xs">
                    <span className="text-foreground font-medium">
                        Feature:
                    </span>{' '}
                    {feature}
                </p>
            ) : null}
            <p className="text-muted-foreground text-xs wrap-break-word">
                {error.message}
            </p>
            {error.stack ? (
                <details className="mt-2">
                    <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs transition-colors">
                        Stack trace
                    </summary>
                    <pre className="text-muted-foreground mt-2 max-h-64 overflow-auto text-xs">
                        {error.stack}
                    </pre>
                </details>
            ) : null}
        </div>
    )
}
