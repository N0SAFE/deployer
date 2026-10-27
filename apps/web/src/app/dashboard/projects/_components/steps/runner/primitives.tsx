'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Plus, X } from 'lucide-react'

export function TagsInput({ value, onChange, placeholder }: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  return (
    <Input
      value={value.join(', ')}
      onChange={(e) => { onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) }}
      placeholder={placeholder}
      className="font-mono text-xs"
    />
  )
}

export function NumberField({ value, onChange, options, placeholder }: {
  value: number
  onChange: (v: number) => void
  options: readonly string[]
  placeholder?: string
}) {
  const current = String(value)
  const all = options.includes(current) ? [...options] : [current, ...options]
  return (
    <Select value={current} onValueChange={(v) => { onChange(Number(v)) }}>
      <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {all.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
      </SelectContent>
    </Select>
  )
}

export function KeyValueEditor({ value, onChange, keyPlaceholder, valuePlaceholder }: {
  value: Record<string, string>
  onChange: (next: Record<string, string>) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
}) {
  const entries = Object.entries(value)
  const update = (next: Record<string, string>) => { onChange(next) }
  return (
    <div className="space-y-1.5">
      {entries.length === 0 && <p className="text-xs text-muted-foreground">No entries.</p>}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1.5">
          <Input
            value={k}
            onChange={(e) => {
              const nv: Record<string, string> = {}
              for (const [kk, vv] of Object.entries(value)) { if (kk !== k) nv[kk] = vv }
              if (e.target.value) nv[e.target.value] = v
              update(nv)
            }}
            placeholder={keyPlaceholder}
            className="h-7 font-mono text-xs"
          />
          <span className="text-muted-foreground">=</span>
          <Input
            value={v}
            onChange={(e) => { update({ ...value, [k]: e.target.value }) }}
            placeholder={valuePlaceholder}
            className="h-7 flex-1 font-mono text-xs"
          />
          <Button type="button" variant="ghost" size="icon" className="size-6 shrink-0" aria-label={`Remove variable ${k}`} onClick={() => {
            const nv: Record<string, string> = {}
            for (const [kk, vv] of Object.entries(value)) { if (kk !== k) nv[kk] = vv }
            update(nv)
          }}>
            <X className="size-3" />
          </Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-6 w-fit gap-1 text-xs" onClick={() => {
        update({ ...value, [`key${String(entries.length + 1)}`]: '' })
      }}>
        <Plus className="size-3" /> Add
      </Button>
    </div>
  )
}
