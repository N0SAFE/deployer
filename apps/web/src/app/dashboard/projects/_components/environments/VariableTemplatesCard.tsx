'use client'

import { useState } from 'react'
import { Pencil, Plus, Trash2, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@deployer/ui/components/shadcn/table'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { EmptyState } from '@/components/dashboard'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import {
  useCreateProjectVariableTemplate,
  useDeleteProjectVariableTemplate,
  useUpdateProjectVariableTemplate,
} from '@/domains/project/hooks'
import { ConfirmDialog } from '../ConfirmDialog'
import type { VariableTemplate } from './types'

type Dialogs =
  | { kind: 'create' }
  | { kind: 'edit'; template: VariableTemplate }
  | { kind: 'delete'; template: VariableTemplate }
  | null

const errDescription = (err: unknown): string => (isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE)

function TemplateFormDialog({
  title,
  description,
  initialName,
  initialDescription,
  submitLabel,
  pending,
  onSubmit,
  onClose,
}: {
  title: string
  description: string
  initialName: string
  initialDescription: string
  submitLabel: string
  pending: boolean
  onSubmit: (name: string, description: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initialName)
  const [desc, setDesc] = useState(initialDescription)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid gap-2"><Label htmlFor="tpl-name">Name</Label><Input id="tpl-name" value={name} onChange={(e) => { setName(e.target.value) }} placeholder="e.g. Database config" /></div>
          <div className="grid gap-2"><Label htmlFor="tpl-desc">Description (optional)</Label><Input id="tpl-desc" value={desc} onChange={(e) => { setDesc(e.target.value) }} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() => {
              if (!name.trim()) { toast.error('Template name is required'); return }
              onSubmit(name.trim(), desc.trim())
            }}
          >
            {pending ? 'Working…' : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Reusable variable templates for the project: list + create / edit / delete. */
export function VariableTemplatesCard({ projectId, templates }: { projectId: string; templates: readonly VariableTemplate[] }) {
  const [dialog, setDialog] = useState<Dialogs>(null)
  const createTemplate = useCreateProjectVariableTemplate()
  const updateTemplate = useUpdateProjectVariableTemplate()
  const deleteTemplate = useDeleteProjectVariableTemplate()
  const close = () => { setDialog(null) }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle>Variable templates</CardTitle>
          <CardDescription>Reusable sets of variables you can apply to any service (Service → Configuration → Variables).</CardDescription>
        </div>
        <Button size="sm" onClick={() => { setDialog({ kind: 'create' }) }}><Plus className="mr-2 size-4" />Add template</Button>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <EmptyState
            compact
            icon={FileText}
            title="No variable templates yet"
            description="Create a template to reuse the same environment variables across services."
            action={{ label: 'Add template', onClick: () => { setDialog({ kind: 'create' }) } }}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-24 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((tpl) => (
                  <TableRow key={tpl.id}>
                    <TableCell className="font-medium">{tpl.name}</TableCell>
                    <TableCell className="text-muted-foreground">{tpl.description ?? '—'}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Edit template ${tpl.name}`} title="Edit" onClick={() => { setDialog({ kind: 'edit', template: tpl }) }}><Pencil className="size-4" /></Button>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Delete template ${tpl.name}`} title="Delete" onClick={() => { setDialog({ kind: 'delete', template: tpl }) }}><Trash2 className="size-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {dialog?.kind === 'create' ? (
        <TemplateFormDialog
          title="Create variable template"
          description="Define a reusable set of environment variables."
          initialName=""
          initialDescription=""
          submitLabel="Create template"
          pending={createTemplate.isPending}
          onClose={close}
          onSubmit={(name, description) => {
            void createTemplate
              .mutateAsync({ params: { id: projectId }, body: { name, description: description || undefined } })
              .then(() => { toast.success('Variable template created'); close() })
              .catch((err: unknown) => { toast.error('Failed to create template', { description: errDescription(err) }) })
          }}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <TemplateFormDialog
          key={dialog.template.id}
          title="Edit variable template"
          description="Update the template name and description."
          initialName={dialog.template.name}
          initialDescription={dialog.template.description ?? ''}
          submitLabel="Save changes"
          pending={updateTemplate.isPending}
          onClose={close}
          onSubmit={(name, description) => {
            void updateTemplate
              .mutateAsync({ params: { id: projectId, templateId: dialog.template.id }, body: { name, description: description || undefined } })
              .then(() => { toast.success('Variable template updated'); close() })
              .catch((err: unknown) => { toast.error('Failed to update template', { description: errDescription(err) }) })
          }}
        />
      ) : null}
      {dialog?.kind === 'delete' ? (
        <ConfirmDialog
          title="Delete variable template"
          objectName={dialog.template.name}
          consequence="the template is removed from this project. Services that already copied its variables keep them."
          confirmLabel="Delete template"
          pending={deleteTemplate.isPending}
          onClose={close}
          onConfirm={() => {
            void deleteTemplate
              .mutateAsync({ params: { id: projectId, templateId: dialog.template.id } })
              .then(() => { toast.success('Variable template deleted'); close() })
              .catch((err: unknown) => { toast.error('Failed to delete template', { description: errDescription(err) }) })
          }}
        />
      ) : null}
    </Card>
  )
}
