'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'

/** Icon-only copy button for ids, addresses and hostnames. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-6 shrink-0"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => { setCopied(false) }, 1500)
          })
          .catch(() => { setCopied(false) })
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

/** A monospace value with its copy button. */
export function CopyableMono({ value, label }: { value: string; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{value}</code>
      <CopyButton value={value} label={label ?? `Copy ${value}`} />
    </span>
  )
}
