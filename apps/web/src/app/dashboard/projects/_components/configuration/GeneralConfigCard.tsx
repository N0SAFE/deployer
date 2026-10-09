'use client'

import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import { useUpdateProjectGeneralConfig } from '@/domains/project/hooks'
import { CopyButton } from '../workload/CopyButton'

interface GeneralValues { name: string; description: string; baseDomain: string }

function GeneralForm({ projectId, initial, onDone }: { projectId: string; initial: GeneralValues; onDone: () => void }) {
  const update = useUpdateProjectGeneralConfig()
  const form = useForm({
    defaultValues: initial,
    onSubmit: async ({ value }) => {
      if (!value.name.trim()) { toast.error('Project name is required'); return }
      try {
        await update.mutateAsync({
          params: { id: projectId },
          body: { name: value.name.trim(), description: value.description.trim(), baseDomain: value.baseDomain.trim() },
        })
        toast.success('Project configuration updated')
        onDone()
      } catch (err) {
        toast.error('Failed to update project', { description: isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE })
      }
    },
  })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <form.Field name="name">
          {(field) => (<div className="grid gap-1.5"><Label htmlFor="gen-name">Name</Label><Input id="gen-name" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} /></div>)}
        </form.Field>
        <form.Field name="description">
          {(field) => (<div className="grid gap-1.5"><Label htmlFor="gen-desc">Description</Label><Input id="gen-desc" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} /></div>)}
        </form.Field>
        <form.Field name="baseDomain">
          {(field) => (<div className="grid gap-1.5"><Label htmlFor="gen-domain">Base domain</Label><Input id="gen-domain" placeholder="example.com" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} /></div>)}
        </form.Field>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onDone} disabled={update.isPending}>Cancel</Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(isSubmitting) => (
            <Button size="sm" onClick={() => { void form.handleSubmit() }} disabled={isSubmitting || update.isPending}>
              {update.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </div>
  )
}

/** Name, description and base domain of the project. The form mounts only while editing, seeded from the project. */
export function GeneralConfigCard({ projectId, project }: { projectId: string; project: { id: string; name: string; description?: string | null; baseDomain?: string | null } }) {
  const [editing, setEditing] = useState(false)
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <CardTitle className="text-base">General</CardTitle>
          <CardDescription>Name, description and base domain of {project.name}. The base domain is the default parent of generated service URLs.</CardDescription>
        </div>
        {editing ? null : <Button size="sm" variant="outline" onClick={() => { setEditing(true) }}>Edit</Button>}
      </CardHeader>
      <CardContent>
        {editing ? (
          <GeneralForm
            projectId={projectId}
            initial={{ name: project.name, description: project.description ?? '', baseDomain: project.baseDomain ?? '' }}
            onDone={() => { setEditing(false) }}
          />
        ) : (
          <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
            <div>
              <dt className="font-medium">Project ID</dt>
              <dd className="flex items-center gap-1 font-mono text-muted-foreground">{project.id}<CopyButton value={project.id} label="Copy project ID" /></dd>
            </div>
            <div><dt className="font-medium">Name</dt><dd className="text-muted-foreground">{project.name}</dd></div>
            <div><dt className="font-medium">Description</dt><dd className="text-muted-foreground">{project.description ?? 'No description'}</dd></div>
            <div><dt className="font-medium">Base domain</dt><dd className="text-muted-foreground">{project.baseDomain ?? 'Not configured — set one to get generated service URLs'}</dd></div>
          </dl>
        )}
      </CardContent>
    </Card>
  )
}
