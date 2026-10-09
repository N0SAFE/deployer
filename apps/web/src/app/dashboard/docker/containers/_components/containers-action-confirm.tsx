'use client'

import { DockerConfirmDialog } from '../../_components/docker-confirm-dialog'
import type { ContainerActionRequest } from '../_hooks/use-container-actions'

function describeObjects(request: ContainerActionRequest): string {
  const names = request.rows.map((row) => row.name)
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} and ${String(names.length - 3)} more`
}

/** Confirmation for Stop and Remove: names the containers and states what will happen. */
export function ContainersActionConfirm({ request, pending, onConfirm, onCancel }: {
  request: ContainerActionRequest | null
  pending: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!request) return null
  const count = request.rows.length
  const noun = count === 1 ? 'container' : `${String(count)} containers`
  const managed = request.rows.filter((row) => row.managedBy === 'deployment_service').length

  const isRemove = request.action === 'remove'
  const managedNote = isRemove && managed > 0
    ? ` ${String(managed)} ${managed === 1 ? 'is' : 'are'} managed by a deployment, so removing ${managed === 1 ? 'it' : 'them'} can break that deployment.`
    : ''

  return (
    <DockerConfirmDialog
      open
      onOpenChange={(open) => { if (!open) onCancel() }}
      title={isRemove ? `Remove ${noun}?` : `Stop ${noun}?`}
      objectName={describeObjects(request)}
      consequence={isRemove
        ? `the container and anything written inside it that is not stored in a volume will be permanently deleted. This cannot be undone.${managedNote}`
        : 'running processes are stopped and in-flight requests are dropped. The container stays on disk and can be started again.'}
      confirmLabel={isRemove ? `Remove ${noun}` : `Stop ${noun}`}
      pending={pending}
      onConfirm={onConfirm}
    />
  )
}
