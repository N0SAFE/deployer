'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'
import { cn } from '@/lib/utils'

/** Icon-only copy button with an accessible name and a transient "copied" state. */
export function DockerCopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className={className}
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      title={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => { setCopied(false) }, 1500)
        }).catch(() => { setCopied(false) })
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  )
}

/** Monospace id (shortened) with a copy button that copies the full value. */
export function DockerCopyableId({ value, short, label = 'ID', className }: { value: string; short: string; label?: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <code className="font-mono text-xs" title={value}>{short}</code>
      <DockerCopyButton value={value} label={label} />
    </span>
  )
}
