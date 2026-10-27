'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { displayValue, type ConfigField } from './config-fields'

/** One schema-driven config field. */
export function DynamicField({ field, value, onChange }: { field: ConfigField; value: unknown; onChange: (val: unknown) => void }) {
  const id = `field-${field.key}`
  const hasValue = value !== null && value !== undefined
  const strVal = displayValue(hasValue ? value : field.defaultValue)
  const boolVal = hasValue ? Boolean(value) : Boolean(field.defaultValue)
  const label = `${field.label}${field.required ? ' *' : ''}`

  switch (field.type) {
    case 'text':
    case 'url':
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{label}</Label>
          {field.description ? <p className="text-sm text-muted-foreground">{field.description}</p> : null}
          <Input id={id} type={field.type === 'url' ? 'url' : 'text'} value={strVal} onChange={(e) => { onChange(e.target.value) }} placeholder={field.placeholder} />
        </div>
      )
    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <Switch id={id} checked={boolVal} onCheckedChange={onChange} />
          <Label htmlFor={id}>{field.label}</Label>
        </div>
      )
    case 'select':
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{label}</Label>
          <Select value={strVal} onValueChange={(v) => { onChange(v) }}>
            <SelectTrigger id={id}><SelectValue placeholder={`Select ${field.label}`} /></SelectTrigger>
            <SelectContent>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={displayValue(opt.value)} value={displayValue(opt.value)}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    case 'json': {
      const source = hasValue ? value : field.defaultValue
      const raw = source ? JSON.stringify(source, null, 2) : '{}'
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{label}</Label>
          {field.description ? <p className="text-sm text-muted-foreground">{field.description}</p> : null}
          <textarea
            id={id}
            className="flex min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm"
            value={raw}
            onChange={(e) => { try { onChange(JSON.parse(e.target.value)) } catch { /* keep the last valid JSON */ } }}
            placeholder={field.placeholder ?? '{}'}
          />
        </div>
      )
    }
    default:
      return (
        <div className="space-y-1.5">
          <Label htmlFor={id}>{field.label}</Label>
          <Input id={id} value={strVal} disabled />
          <p className="text-sm text-muted-foreground">This field type ({field.type}) cannot be edited here.</p>
        </div>
      )
  }
}
