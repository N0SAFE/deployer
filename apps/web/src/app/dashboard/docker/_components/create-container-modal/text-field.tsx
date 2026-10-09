'use client'

import type { ReactNode } from 'react'
import { Input } from '@repo/ui/components/shadcn/input'
import { FieldError, Field, SELECT_CLASS } from './form-primitives'
import type { ContainerForm } from './use-container-form'

/** Labelled text input bound to a form field name. */
export function TextField({ form, name, label, value, onChange, placeholder, hint, required, mono, className }: {
  form: ContainerForm
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  hint?: ReactNode
  required?: boolean
  mono?: boolean
  className?: string
}) {
  return (
    <Field form={form} name={name} label={label} required={required} hint={hint} className={className}>
      {(props) => (
        <Input {...props} value={value} placeholder={placeholder} className={mono ? 'font-mono' : undefined} onChange={(event) => { onChange(event.target.value) }} />
      )}
    </Field>
  )
}

/** Labelled native select bound to a form field name. */
export function SelectField<T extends string>({ form, name, label, value, options, onChange, className }: {
  form: ContainerForm
  name: string
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    <Field form={form} name={name} label={label} className={className}>
      {(props) => (
        <select
          {...props}
          className={SELECT_CLASS}
          value={value}
          onChange={(event) => {
            const next = options.find((option) => option.value === event.target.value)
            if (next) onChange(next.value)
          }}
        >
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </Field>
  )
}

/** Input inside a repeated row: labelled for assistive tech, error shown under the row cell. */
export function RowInput({ form, name, label, value, onChange, placeholder, mono = true }: {
  form: ContainerForm
  name: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  mono?: boolean
}) {
  const props = form.fieldProps(name)
  return (
    <div className="min-w-0">
      <Input {...props} aria-label={label} value={value} placeholder={placeholder} className={mono ? 'font-mono' : undefined} onChange={(event) => { onChange(event.target.value) }} />
      <FieldError form={form} name={name} />
    </div>
  )
}

export function CheckboxField({ id, label, checked, onChange, hint }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; hint?: string }) {
  return (
    <div>
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input id={id} type="checkbox" checked={checked} onChange={(event) => { onChange(event.target.checked) }} />
        {label}
      </label>
      {hint ? <p className="ml-6 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
