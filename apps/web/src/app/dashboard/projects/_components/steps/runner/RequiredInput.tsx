'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { RequiredError } from '../required-error'

/** Text input for a required runner field: shows the "required" error once left empty. */
export function RequiredInput({ value, onChange, onBlur, touched, message, placeholder, className }: {
  value: string
  onChange: (next: string) => void
  onBlur: () => void
  touched: boolean
  message: string
  placeholder?: string
  className?: string
}) {
  const invalid = touched && value.trim() === ''
  return (
    <>
      <Input value={value} onChange={(e) => { onChange(e.target.value) }} onBlur={onBlur} placeholder={placeholder} className={className} aria-invalid={invalid || undefined} />
      <RequiredError touched={touched} value={value} message={message} />
    </>
  )
}
