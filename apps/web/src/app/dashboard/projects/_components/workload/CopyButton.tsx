'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@repo/ui/components/shadcn/button'

/** Icon button that copies `value`. Every id shown in mono gets one. */
export function CopyButton({ value, label, className }: { value: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={className ?? 'size-6'}
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          window.setTimeout(() => { setCopied(false) }, 1500)
        })
      }}
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
    </Button>
  )
}

/** Short mono id + copy button. */
export function IdChip({ id, label = 'Copy id', chars = 8 }: { id: string; label?: string; chars?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      <code className="font-mono text-xs text-muted-foreground" title={id}>{id.slice(0, chars)}</code>
      <CopyButton value={id} label={label} />
    </span>
  )
}
