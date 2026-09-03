'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCreateServiceForm } from './CreateService.hook'
import { RunnerDetectionProvider } from './steps/runner-detection-context'
import { validateStep } from './steps/step-validation'
import { StepBasicInfo } from './steps/StepBasicInfo'
import { StepProvider } from './steps/StepProvider'
import { StepBuilder } from './steps/StepBuilder'
import { StepRunner } from './steps/StepRunner'
import { StepRuntime } from './steps/StepRuntime'
import { StepNetwork } from './steps/StepNetwork'
import { StepDomains } from './steps/StepDomains'
import { StepAdvanced } from './steps/StepAdvanced'
import { StepReview } from './steps/StepReview'

/* ─── Step config ─── */

interface StepDef {
  id: number
  label: string
  render: (props: StepProps) => React.ReactNode
}

interface StepProps {
  form: ReturnType<typeof useCreateServiceForm>
  projectId: string
}

const ALL_STEPS: StepDef[] = [
  { id: 1, label: 'Basic info', render: ({ form }) => <StepBasicInfo form={form} /> },
  { id: 2, label: 'Source', render: ({ form }) => <StepProvider form={form} /> },
  { id: 3, label: 'Builder', render: ({ form }) => <StepBuilder form={form} /> },
  { id: 4, label: 'Runner', render: ({ form }) => <StepRunner form={form} /> },
  { id: 5, label: 'Runtime', render: ({ form }) => <StepRuntime form={form} /> },
  { id: 6, label: 'Network', render: ({ form }) => <StepNetwork form={form} /> },
  { id: 7, label: 'Domains', render: ({ form, projectId }) => <StepDomains form={form} projectId={projectId} /> },
  { id: 8, label: 'Advanced', render: ({ form }) => <StepAdvanced form={form} /> },
  { id: 9, label: 'Review', render: ({ form }) => <StepReview form={form} /> },
]

/**
 * Steps whose content is a no-op for a given runner state. When a runner is
 * detected we hide these so the wizard only shows meaningful steps.
 */
function hiddenStepIds(runnerId: string, subServiceCount: number): Set<number> {
  const hidden = new Set<number>()
  // Orchestrator with sub-services: runtime/network/domains live inside each
  // sub-service (Runner step) — the dedicated steps are empty shells.
  if (runnerId === 'orchestrator' && subServiceCount > 0) {
    hidden.add(5) // Runtime
    hidden.add(6) // Network
    hidden.add(7) // Domains
  }
  // Compose stack: the stack owns networking/runtime — the shell is one unit.
  if (runnerId === 'compose') {
    hidden.add(5) // Runtime
    hidden.add(6) // Network
  }
  // Static: no runtime process config to set.
  if (runnerId === 'static') {
    hidden.add(5) // Runtime
  }
  return hidden
}

/* ─── Props ─── */

interface CreateServiceWizardProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  onConfirm: (data: unknown) => Promise<void>
  creating: boolean
}

/* ─── Inner dialog (inside RunnerDetectionProvider) ────────────────── */

function WizardDialog({ onOpenChange, projectId, onConfirm, creating }: {
  onOpenChange: (open: boolean) => void
  projectId: string
  onConfirm: (data: unknown) => Promise<void>
  creating: boolean
}) {
  const form = useCreateServiceForm(async (data) => {
    await onConfirm(data)
  })
  const [step, setStep] = useState(0)

  const handleReset = () => { setStep(0); form.reset() }
  const handleClose = () => { onOpenChange(false); handleReset() }
  const handleConfirm = async () => { await form.handleSubmit(); handleReset() }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-xl border bg-background shadow-2xl">
        {/* Subscribe to live form values → reactive step filtering + per-step validation */}
        <form.Subscribe selector={(s) => s.values} children={(rawValues) => {
          const values = rawValues

          // Filter steps based on the current runner state (live).
          const visibleSteps = (() => {
            const runnerId = values.runner.runnerId
            const subServiceCount = runnerId === 'orchestrator'
              ? ((values.runner.config as { subServices?: unknown[] }).subServices ?? []).length
              : 0
            const hidden = hiddenStepIds(runnerId, subServiceCount)
            return ALL_STEPS.filter((s) => !hidden.has(s.id))
          })()

          // Clamp the current step into the visible range (e.g. after a runner change).
          const safeStep = Math.min(step, Math.max(visibleSteps.length - 1, 0))
          const current = visibleSteps[safeStep]

          // Per-step validation — the Next button is disabled while the current
          // step's slice of the form is invalid.
          const stepValidation = current ? validateStep(values, current.id) : { valid: true, issues: [] }
          const nextDisabled = !stepValidation.valid
          const isLast = safeStep >= visibleSteps.length - 1

          /* ─── Stepper ─── */
          const stepIndicator = (
            <div className="flex items-center gap-2 pt-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${String(((safeStep + 1) / Math.max(visibleSteps.length, 1)) * 100)}%` }}
                />
              </div>
              <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
                {safeStep + 1}/{visibleSteps.length}
              </span>
            </div>
          )

          return (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (isLast) { void handleConfirm() } else { setStep(safeStep + 1) }
              }}
            >
              {/* Header */}
              <div className="border-b px-6 py-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Create service</h2>
                  <span className="text-xs text-muted-foreground">
                    {current?.label}
                  </span>
                </div>
                {stepIndicator}
              </div>

              {/* Step content */}
              <div className="max-h-[60vh] overflow-y-auto px-6 py-4">{current?.render({ form, projectId })}</div>

              {/* Footer */}
              <div className="flex items-center justify-between border-t px-6 py-4">
                <div>
                  {safeStep > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setStep(safeStep - 1) }}>
                      <ChevronLeft className="mr-1 size-4" /> Back
                    </Button>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {nextDisabled && stepValidation.issues[0] && (
                    <p className="max-w-64 truncate text-[10px] text-destructive" title={stepValidation.issues[0]}>
                      {stepValidation.issues[0]}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={creating}>
                      Cancel
                    </Button>
                    {!isLast
                      ? <Button type="submit" size="sm" disabled={nextDisabled}>Next <ChevronRight className="ml-1 size-4" /></Button>
                      : <Button type="submit" size="sm" disabled={creating || nextDisabled}>
                        {creating ? <><span className="mr-2 size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Creating…</> : 'Create service'}
                      </Button>}
                  </div>
                </div>
              </div>
            </form>
          )
        }} />
      </div>
    </div>
  )
}

/* ─── Public component ─────────────────────────────────────────────── */

export function CreateServiceWizard({
  open,
  onOpenChange,
  projectId,
  onConfirm,
  creating,
}: CreateServiceWizardProps) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/50" onClick={() => { onOpenChange(false) }} />}
      {open && (
        <RunnerDetectionProvider>
          <WizardDialog
            onOpenChange={onOpenChange}
            projectId={projectId}
            onConfirm={onConfirm}
            creating={creating}
          />
        </RunnerDetectionProvider>
      )}
    </>
  )
}
