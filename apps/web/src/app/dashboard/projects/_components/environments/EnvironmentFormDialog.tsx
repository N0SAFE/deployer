'use client'

import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { z } from 'zod/v4'
import { ENVIRONMENT_KINDS, environmentKindSchema, type EnvironmentKind } from '@repo/contracts-common'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'

const envFormSchema = z.object({
  name: z.string().trim().min(1, 'Environment name is required'),
  kind: z.enum(environmentKindSchema.options),
  description: z.string(),
})

export interface EnvironmentFormValues {
  name: string
  kind: EnvironmentKind
  description: string
}

export type EnvironmentFormMode = 'create' | 'edit' | 'clone'

const COPY: Record<EnvironmentFormMode, { title: string; description: string; submit: string; pending: string }> = {
  create: { title: 'Create environment', description: 'Add a deployment environment to this project.', submit: 'Create environment', pending: 'Creating…' },
  edit: { title: 'Edit environment', description: 'Update the name, kind and description.', submit: 'Save changes', pending: 'Saving…' },
  clone: { title: 'Clone environment', description: 'Create a copy of this environment under a new name.', submit: 'Clone environment', pending: 'Cloning…' },
}

/**
 * One dialog for create / edit / clone. Mount it only while open (and key it by
 * the target) so the form starts from `initial` without any reset effect.
 */
export function EnvironmentFormDialog({
  mode,
  initial,
  pending,
  onSubmit,
  onClose,
}: {
  mode: EnvironmentFormMode
  initial: EnvironmentFormValues
  pending: boolean
  onSubmit: (values: EnvironmentFormValues) => Promise<void>
  onClose: () => void
}) {
  const copy = COPY[mode]
  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      const parsed = envFormSchema.safeParse(value)
      if (!parsed.success) {
        toast.error(parsed.error.issues[0]?.message ?? 'Invalid input')
        return
      }
      await onSubmit({ name: parsed.data.name, kind: parsed.data.kind, description: parsed.data.description.trim() })
    },
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <form.Field name="name">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor={`env-${mode}-name`}>{mode === 'clone' ? 'New name' : 'Name'}</Label>
                <Input id={`env-${mode}-name`} placeholder="e.g. staging" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} />
              </div>
            )}
          </form.Field>
          <form.Field name="kind">
            {(field) => (
              <div className="grid gap-2">
                <Label htmlFor={`env-${mode}-kind`}>Kind</Label>
                <Select value={field.state.value} onValueChange={(v) => { field.handleChange(v as EnvironmentKind) }}>
                  <SelectTrigger id={`env-${mode}-kind`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ENVIRONMENT_KINDS.map((k) => (<SelectItem key={k} value={k}>{k}</SelectItem>))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">stable = long-lived · preview = PR/branch-triggered · ephemeral = short-lived</p>
              </div>
            )}
          </form.Field>
          {mode !== 'clone' ? (
            <form.Field name="description">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={`env-${mode}-desc`}>Description (optional)</Label>
                  <Input id={`env-${mode}-desc`} placeholder="Brief description" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} />
                </div>
              )}
            </form.Field>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(isSubmitting) => (
              <Button onClick={() => { void form.handleSubmit() }} disabled={isSubmitting || pending}>
                {pending ? copy.pending : copy.submit}
              </Button>
            )}
          </form.Subscribe>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
