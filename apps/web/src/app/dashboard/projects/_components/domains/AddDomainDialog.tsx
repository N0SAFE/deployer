'use client'

import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import z from 'zod/v4'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { Field, FieldDescription, FieldLabel } from '@deployer/ui/components/shadcn/field'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Switch } from '@deployer/ui/components/shadcn/switch'

const addDomainSchema = z.object({
  domain: z.string().trim().min(1, 'Domain is required').regex(/^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i, 'Invalid domain format'),
  isPrimary: z.boolean(),
  subdomains: z.string(),
})

export interface AddDomainValues {
  domain: string
  isPrimary: boolean
  allowedSubdomains: string[]
}

/** Parse the comma-separated allowed-subdomains field. */
export function parseSubdomains(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

/** Mount only while open so the form starts empty every time. */
export function AddDomainDialog({
  pending,
  onAdd,
  onClose,
}: {
  pending: boolean
  onAdd: (values: AddDomainValues) => Promise<void>
  onClose: () => void
}) {
  const form = useForm({
    defaultValues: { domain: '', isPrimary: false, subdomains: '' },
    onSubmit: async ({ value }) => {
      const parsed = addDomainSchema.safeParse(value)
      if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? 'Invalid input'); return }
      await onAdd({ domain: parsed.data.domain, isPrimary: parsed.data.isPrimary, allowedSubdomains: parseSubdomains(parsed.data.subdomains) })
    },
  })
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add domain</DialogTitle>
          <DialogDescription>
            Attach a domain to this project. It stays <strong>pending</strong> until its DNS ownership is verified; services can bind to it once it is verified.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <form.Field name="domain">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="domain">Domain</FieldLabel>
                <FieldDescription>Example: example.com or app.example.com</FieldDescription>
                <Input id="domain" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} placeholder="example.com" />
              </Field>
            )}
          </form.Field>
          <form.Field name="isPrimary">
            {(field) => (
              <div className="flex items-center gap-2">
                <Switch id="isPrimary" checked={field.state.value} onCheckedChange={(v) => { field.handleChange(v) }} />
                <Label htmlFor="isPrimary">Set as primary domain</Label>
              </div>
            )}
          </form.Field>
          <form.Field name="subdomains">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="subdomains">Allowed subdomains</FieldLabel>
                <FieldDescription>Comma-separated list (e.g. www, api, admin). Leave empty to allow all.</FieldDescription>
                <Input id="subdomains" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} placeholder="www, api, admin" />
              </Field>
            )}
          </form.Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button onClick={() => { void form.handleSubmit() }} disabled={isSubmitting || pending}>
                {pending ? 'Adding…' : 'Add domain'}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
