'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Input } from '@deployer/ui/components/shadcn/input'

/** A secret field: masked by default, with an explicit reveal. Never autofilled. */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  invalid,
  describedBy,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  invalid?: boolean
  describedBy?: string
}) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="relative">
      <Input
        id={id}
        type={revealed ? 'text' : 'password'}
        autoComplete="off"
        spellCheck={false}
        className="pr-10 font-mono text-sm"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => { onChange(e.target.value); }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute right-0 top-0 size-9"
        aria-label={revealed ? 'Hide secret' : 'Reveal secret'}
        aria-pressed={revealed}
        onClick={() => { setRevealed((v) => !v); }}
      >
        {revealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  )
}
