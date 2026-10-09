'use client'

import { useState } from 'react'
import { ShieldCheck, Trash2 } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { ConfirmDialog } from '../ConfirmDialog'
import { resolveFullUrl, sslLabel } from './domain-url'

/** One domain binding of a service, with a confirmed remove. */
export function DomainEntryRow({
  domainName,
  subdomain,
  basePath,
  isPrimary,
  sslEnabled,
  sslProvider,
  onRemove,
  disabled,
}: {
  domainName: string
  subdomain: string | null
  basePath: string | null
  isPrimary: boolean
  sslEnabled: boolean
  sslProvider?: string | null
  onRemove: () => void
  disabled?: boolean
}) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const url = resolveFullUrl(domainName, subdomain, basePath)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground">{url}</code>
          {isPrimary ? <Badge variant="default">Primary</Badge> : null}
          <Badge variant={sslEnabled ? 'outline' : 'secondary'} className="gap-1">
            <ShieldCheck className="size-3" aria-hidden /> {sslLabel(sslEnabled, sslProvider)}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {subdomain ? `Subdomain "${subdomain}" of ${domainName}` : `Root of ${domainName}`}
          {basePath ? ` · path /${basePath}` : ''}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        onClick={() => { setConfirmOpen(true) }}
        disabled={disabled}
        title="Remove domain"
        aria-label={`Remove ${url}`}
      >
        <Trash2 className="size-4" />
      </Button>
      {confirmOpen ? (
        <ConfirmDialog
          title="Remove this domain from the service?"
          objectName={url}
          consequence="stops routing to this service. DNS records already created at your provider are not deleted."
          confirmLabel="Remove domain"
          pending={false}
          onClose={() => { setConfirmOpen(false) }}
          onConfirm={() => { setConfirmOpen(false); onRemove() }}
        />
      ) : null}
    </div>
  )
}
