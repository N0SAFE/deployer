'use client'

import { useId, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2, X } from 'lucide-react'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { fieldErrorId, type ContainerForm } from './use-container-form'

/** Native select styled like the inputs; always give it an `id` + label or `aria-label`. */
export const SELECT_CLASS = 'h-8 w-full rounded-md border bg-background px-2 text-sm'

export function FieldError({ form, name }: { form: ContainerForm; name: string }) {
  const message = form.errorFor(name)
  if (!message) return null
  return <p id={fieldErrorId(name)} className="mt-1 text-xs text-destructive">{message}</p>
}

/** Label + control + hint + error, wired together with htmlFor / aria-describedby. */
export function Field({ form, name, label, required, hint, className, children }: {
  form: ContainerForm
  name: string
  label: string
  required?: boolean
  hint?: ReactNode
  className?: string
  children: (props: ReturnType<ContainerForm['fieldProps']>) => ReactNode
}) {
  const props = form.fieldProps(name)
  const hintId = `${props.id}-hint`
  const describedBy = [hint ? hintId : undefined, props['aria-describedby']].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <Label htmlFor={props.id} className="mb-1.5">
        {label}{required ? <span aria-hidden="true" className="text-destructive"> *</span> : null}
        {required ? <span className="sr-only"> (required)</span> : null}
      </Label>
      {children({ ...props, 'aria-describedby': describedBy })}
      {hint ? <p id={hintId} className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      <FieldError form={form} name={name} />
    </div>
  )
}

/** Titled group of related fields (ports, volumes, …) with a short explanation. */
export function FormSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-md border p-3">
      <div>
        <h3 className="text-sm font-medium">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Collapsed-by-default group for the less common options. */
export function CollapsibleSection({ title, summary, icon, children }: { title: string; summary?: string; icon: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  return (
    <section className="rounded-md border">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
        onClick={() => { setOpen((previous) => !previous) }}
      >
        <span className="inline-flex items-center gap-2 text-sm font-medium">{icon}{title}</span>
        <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          {summary}
          {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        </span>
      </button>
      <div id={panelId} hidden={!open} className="space-y-3 border-t p-3">{children}</div>
    </section>
  )
}

export function RemoveRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="icon" aria-label={label} title={label} onClick={onClick}>
      <Trash2 aria-hidden="true" />
    </Button>
  )
}

export function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      <Plus aria-hidden="true" /> {label}
    </Button>
  )
}

/** Column captions shown once above a list of rows (the inputs carry their own aria-label). */
export function RowHeader({ columns, template }: { columns: string[]; template: string }) {
  return (
    <div aria-hidden="true" className={`hidden gap-2 text-xs text-muted-foreground md:grid ${template}`}>
      {columns.map((column) => <span key={column}>{column}</span>)}
      <span className="w-8" />
    </div>
  )
}

/** Free-text list: type a value, press Enter or "Add"; each value is a removable chip. */
export function TagInput({ label, placeholder, values, onChange, mono = true, normalize }: {
  label: string
  placeholder: string
  values: string[]
  onChange: (next: string[]) => void
  mono?: boolean
  normalize?: (value: string) => string
}) {
  const [draft, setDraft] = useState('')
  const inputId = useId()
  const commit = (): void => {
    const value = (normalize ? normalize(draft) : draft).trim()
    if (value && !values.includes(value)) onChange([...values, value])
    setDraft('')
  }
  return (
    <div>
      <Label htmlFor={inputId} className="mb-1.5">{label}</Label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          value={draft}
          placeholder={placeholder}
          className={mono ? 'font-mono' : undefined}
          onChange={(event) => { setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            commit()
          }}
        />
        <Button type="button" variant="outline" disabled={!draft.trim()} onClick={commit}>Add</Button>
      </div>
      {values.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label={`${label} added`}>
          {values.map((value) => (
            <li key={value}>
              <Badge variant="outline" className={`gap-1 text-xs ${mono ? 'font-mono' : ''}`}>
                {value}
                <button type="button" aria-label={`Remove ${value}`} className="rounded-sm hover:text-destructive" onClick={() => { onChange(values.filter((item) => item !== value)) }}>
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** Toggle chips for choosing from a short list (capabilities). */
export function ToggleChips({ label, options, selected, onToggle }: { label: string; options: readonly string[]; selected: string[]; onToggle: (option: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const on = selected.includes(option)
          return (
            <button
              key={option}
              type="button"
              aria-pressed={on}
              className={`rounded border px-2 py-1 font-mono text-xs ${on ? 'border-primary bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted/40'}`}
              onClick={() => { onToggle(option) }}
            >
              {option}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
