'use client'

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

/** A mono id (shortened for display) with a copy button for the full value. */
export function CopyId({ value, label, short = 12, className }: { value: string; label: string; short?: number; className?: string }) {
	const [copied, setCopied] = useState(false)
	const copy = () => {
		void navigator.clipboard.writeText(value).then(() => {
			setCopied(true)
			toast.success(`${label} copied`)
			setTimeout(() => { setCopied(false) }, 1500)
		})
	}
	return (
		<span className={cn('inline-flex items-center gap-1 font-mono text-xs text-muted-foreground', className)}>
			<span title={value}>{value.length > short ? `${value.slice(0, short)}…` : value}</span>
			<button
				type="button"
				onClick={(e) => { e.stopPropagation(); copy() }}
				aria-label={`Copy ${label}`}
				className="rounded p-0.5 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
			>
				{copied ? <Check className="size-3" /> : <Copy className="size-3" />}
			</button>
		</span>
	)
}
