'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Checkbox } from '@deployer/ui/components/shadcn/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'

import { useCreateRole, useUpdateRole, type ManagedRole } from '@/domains/roles/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'

/** The catalog, grouped by resource, so an editor ticks "role: read" under `role` rather than hunting a flat list. */
export interface PermissionGroup {
  readonly resource: string
  readonly permissions: readonly { readonly key: string; readonly description: string }[]
}

export function RoleDialog({
  role,
  groups,
  onClose,
}: {
  /** Absent when creating. The name is immutable afterwards: `user.role` stores it. */
  role?: ManagedRole
  groups: readonly PermissionGroup[]
  onClose: () => void
}) {
  const [name, setName] = useState(role?.name ?? '')
  const [label, setLabel] = useState(role?.label ?? '')
  const [rank, setRank] = useState(String(role?.rank ?? 1))
  const [description, setDescription] = useState(role?.description ?? '')
  const [permissions, setPermissions] = useState<readonly string[]>(role?.permissions ?? [])
  const create = useCreateRole()
  const update = useUpdateRole()
  const pending = create.isPending || update.isPending

  const toggle = (key: string) => {
    setPermissions((current) => (current.includes(key) ? current.filter((p) => p !== key) : [...current, key]))
  }

  const submit = () => {
    const rankNumber = Number(rank)
    const body = {
      label: label.trim(),
      rank: rankNumber,
      description: description.trim() === '' ? null : description.trim(),
      color: null,
      permissions: [...permissions],
    }

    const onSuccess = () => {
      toast.success(role === undefined ? 'Role created' : 'Role updated')
      onClose()
    }
    const onError = (error: unknown) => {
      toast.error(getErrorMessage(error))
    }

    if (role === undefined) {
      create.mutate({ ...body, name: name.trim(), scope: 'platform' as const }, { onSuccess, onError })
      return
    }
    update.mutate({ params: { id: role.id }, body }, { onSuccess, onError })
  }

  const valid =
    label.trim().length >= 2 &&
    Number.isInteger(Number(rank)) &&
    (role !== undefined || /^[a-z][a-z0-9_-]{1,31}$/.test(name.trim()))

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{role === undefined ? 'New custom role' : `Edit ${role.label}`}</DialogTitle>
          <DialogDescription>
            A role may only rank below yours and may only hold permissions you already hold — the server refuses the
            rest, so this cannot be used to grant yourself anything.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 py-2 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="role-name">Name (stored in user.role)</Label>
            <Input
              id="role-name"
              value={name}
              disabled={role !== undefined}
              placeholder="auditor"
              onChange={(event) => { setName(event.target.value) }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-label">Label</Label>
            <Input id="role-label" value={label} onChange={(event) => { setLabel(event.target.value) }} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-rank">Rank (below your own)</Label>
            <Input
              id="role-rank"
              type="number"
              min="-1"
              max="10"
              value={rank}
              onChange={(event) => { setRank(event.target.value) }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="role-description">Description</Label>
            <Input
              id="role-description"
              value={description}
              onChange={(event) => { setDescription(event.target.value) }}
            />
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-sm font-medium">Permissions</p>
          <div className="grid max-h-72 gap-3 overflow-y-auto rounded-md border p-3 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.resource} className="space-y-1">
                <p className="font-mono text-xs text-muted-foreground">{group.resource}</p>
                {group.permissions.map((permission) => (
                  <label key={permission.key} className="flex items-start gap-2 text-sm">
                    <Checkbox
                      checked={permissions.includes(permission.key)}
                      onCheckedChange={() => { toggle(permission.key) }}
                    />
                    <span>
                      <span className="font-mono text-xs">{permission.key.slice(permission.key.indexOf(':') + 1)}</span>
                      <span className="text-muted-foreground block text-xs">{permission.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || pending} onClick={submit}>
            {pending ? 'Saving…' : role === undefined ? 'Create role' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
