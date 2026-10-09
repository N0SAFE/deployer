'use client'

import { type ReactNode, useCallback, useState } from 'react'
import { type DockerContainer } from '@repo/contracts-entities'
import { DockerContainerDetailModalContent } from './container-detail-modal-content'

interface DockerContainerDetailModalTriggerProps {
  id: string
  container?: DockerContainer | null
  onContainerStateChange?: () => unknown
  children: ReactNode
  className?: string
  initialTab?: string
}

export function DockerContainerDetailModalTrigger({
  id,
  container = null,
  onContainerStateChange,
  children,
  className,
  initialTab = 'overview',
}: DockerContainerDetailModalTriggerProps) {
  // Trigger is intentionally tiny: it owns ONLY the open/close flag and
  // renders a button. The heavy modal content (queries, streams, state)
  // is mounted *only* while the dialog is open. Without this split, every
  // cell of the container table (60 rows x 3 triggers = 180 instances)
  // would run the full hook set on every SSE event, even when the user
  // never opens a single modal.
  const [open, setOpen] = useState(false)
  const handleOpen = useCallback(() => { setOpen(true) }, [])

  return (
    <>
      <button
        type="button"
        className={className ?? 'underline-offset-4 hover:underline text-left'}
        onClick={handleOpen}
      >
        {children}
      </button>
      {open ? (
        <DockerContainerDetailModalContent
          id={id}
          container={container}
          onContainerStateChange={onContainerStateChange}
          initialTab={initialTab}
          onOpenChange={setOpen}
        />
      ) : null}
    </>
  )
}
