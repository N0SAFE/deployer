import { useState } from 'react'
import { buildPayload, type DockerCreateContainerPayload } from './container-form.model'
import { describeErrorField } from './container-form.validation'
import type { ContainerForm } from './use-container-form'
import type { PullScanFlow } from './use-pull-scan-flow'

interface Options {
  form: ContainerForm
  flow: PullScanFlow
  onCreated?: (payload: DockerCreateContainerPayload) => void
  onOpenChange: (open: boolean) => void
}

/** Why the "create" button is disabled right now, or null when it can be used. */
export function submitBlockReason(args: { stage: string; canOpenContainer: boolean; busy: boolean; errors: Record<string, string> }): string | null {
  if (args.busy) return 'Waiting for the current pull or scan to finish.'
  if (args.stage !== 'container') {
    return args.canOpenContainer ? 'Open the Container step to review and create.' : 'Pull and scan the image first, then configure the container.'
  }
  const keys = Object.keys(args.errors)
  if (keys.length === 0) return null
  const named = keys.slice(0, 3).map(describeErrorField).join(', ')
  const more = keys.length > 3 ? ` and ${String(keys.length - 3)} more` : ''
  return `Fix ${String(keys.length)} ${keys.length === 1 ? 'field' : 'fields'} first: ${named}${more}.`
}

/**
 * Builds the validated payload and hands it to `onCreated`.
 * NOTE: the engine has no create-container contract yet, so this does not call
 * the API — the parent receives the payload and decides what to do with it.
 */
export function useCreateContainerSubmit({ form, flow, onCreated, onOpenChange }: Options) {
  const [submitting, setSubmitting] = useState(false)
  const blockReason = submitBlockReason({
    stage: flow.activeStage,
    canOpenContainer: flow.canOpenContainer,
    busy: submitting || flow.isRunning,
    errors: form.errors,
  })

  function submit(): void {
    if (blockReason !== null) return
    setSubmitting(true)
    try {
      onCreated?.(buildPayload(form.state, {
        pullStatus: flow.pullStatus,
        scanStatus: flow.scanStatus,
        vulnerabilities: flow.scanVulns,
      }))
      onOpenChange(false)
    } finally {
      setSubmitting(false)
    }
  }

  return { submit, submitting, blockReason }
}
