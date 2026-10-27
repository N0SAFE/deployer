'use client'

import { useState } from 'react'
import { Button } from '@deployer/ui/components/shadcn/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'

export interface ProjectFormValues {
  name: string
  description: string
}

/** Pure validation, shown next to the field instead of as a toast. */
export function validateProjectName(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed.length === 0) return 'Give the project a name.'
  if (trimmed.length > 100) return 'Use at most 100 characters.'
  return null
}

/** Create / edit dialog. Mount it only while open so its fields reset on every open. */
export function ProjectFormDialog({
  mode,
  initial,
  pending,
  onSubmit,
  onClose,
}: {
  mode: 'create' | 'edit'
  initial: ProjectFormValues
  pending: boolean
  onSubmit: (values: ProjectFormValues) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [description, setDescription] = useState(initial.description)
  const [touched, setTouched] = useState(false)
  const error = touched ? validateProjectName(name) : null
  const creating = mode === 'create'

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            setTouched(true)
            if (validateProjectName(name) === null) onSubmit({ name: name.trim(), description: description.trim() })
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>{creating ? 'New project' : 'Edit project'}</DialogTitle>
            <DialogDescription>
              {creating
                ? 'A project groups the services, environments and domains of one product. You add services after it is created.'
                : 'Rename the project or change its description. Services and deployments are not affected.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="project-name">Name</Label>
            <Input
              id="project-name"
              value={name}
              autoFocus
              placeholder="my-product"
              aria-invalid={error !== null}
              aria-describedby={error ? 'project-name-error' : undefined}
              onChange={(event) => { setName(event.target.value) }}
              onBlur={() => { setTouched(true) }}
            />
            {error ? <p id="project-name-error" role="alert" className="text-sm text-destructive">{error}</p> : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="project-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Input
              id="project-description"
              value={description}
              placeholder="What this project is for"
              onChange={(event) => { setDescription(event.target.value) }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={pending}>
              {creating ? (pending ? 'Creating…' : 'Create project') : (pending ? 'Saving…' : 'Save changes')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteProjectDialog({
  name,
  servicesCount,
  pending,
  onConfirm,
  onClose,
}: {
  name: string
  servicesCount: number
  pending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const matches = typed.trim() === name
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete project “{name}”?</DialogTitle>
          <DialogDescription>
            This permanently deletes the project
            {servicesCount > 0 ? `, its ${String(servicesCount)} service${servicesCount === 1 ? '' : 's'}` : ''}
            {' '}and every environment, domain and deployment record under it. Running containers are stopped. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="project-delete-confirm">Type <span className="font-mono font-semibold">{name}</span> to confirm</Label>
          <Input id="project-delete-confirm" value={typed} onChange={(event) => { setTyped(event.target.value) }} autoComplete="off" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!matches || pending} onClick={onConfirm}>
            {pending ? 'Deleting…' : 'Delete project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
