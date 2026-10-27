'use client'

import type { ReactNode } from 'react'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Textarea } from '@deployer/ui/components/shadcn/textarea'
import { cn } from '@/lib/utils'
import { SecretInput } from './secret-input'

/** Label, optional help, the control and its validation message — one accessible unit. */
export function TextField({
  id,
  label,
  help,
  value,
  onChange,
  onBlur,
  error,
  placeholder,
  secret,
  multiline,
  mono,
  optional,
  type,
}: {
  id: string
  label: string
  help?: ReactNode
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  placeholder?: string
  secret?: boolean
  multiline?: boolean
  mono?: boolean
  optional?: boolean
  type?: string
}) {
  const describedBy = [help ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="space-y-1.5" onBlur={onBlur}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span> : null}
      </label>
      {secret && !multiline ? (
        <SecretInput id={id} value={value} onChange={onChange} placeholder={placeholder} invalid={!!error} describedBy={describedBy} />
      ) : multiline ? (
        <Textarea
          id={id}
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          className={cn('min-h-28 text-sm', mono && 'font-mono')}
          onChange={(e) => { onChange(e.target.value); }}
        />
      ) : (
        <Input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          aria-invalid={!!error || undefined}
          aria-describedby={describedBy}
          className={cn(mono && 'font-mono text-sm')}
          onChange={(e) => { onChange(e.target.value); }}
        />
      )}
      {help ? (
        <p id={`${id}-help`} className="text-sm text-muted-foreground">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
