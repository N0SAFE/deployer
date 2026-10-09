'use client'

import { useState } from 'react'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
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

/** "runner.config.startCommand: Required" → "Start command: Required" (field names are jargon in a form). */
export function friendlyIssue(issue: string): string {
  const split = issue.indexOf(': ')
  if (split < 0) return issue
  const path = issue.slice(0, split)
  const message = issue.slice(split + 2)
  const field = path.split('.').filter((part) => part !== '(form)').pop()
  if (!field) return message
  const words = field.replace(/([A-Z])/g, ' $1').toLowerCase().trim()
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}: ${message}`
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
    <Dialog open onOpenChange={(next) => { if (!next && !creating) handleClose() }}>
      <DialogContent className="max-w-2xl gap-0 p-0 sm:max-w-2xl" aria-describedby="wizard-step-description">
        {/* Subscribe to live form values → reactive step filtering + per-step validation */}
        <form.Subscribe selector={(s) => s.values} children={(values) => {
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

          // Per-step validation — Next is disabled while the current step is invalid,
          // and the reasons are listed above the buttons.
          const stepValidation = current ? validateStep(values, current.id) : { valid: true, issues: [] }
          const nextDisabled = !stepValidation.valid
          const isLast = safeStep >= visibleSteps.length - 1
          const issues = stepValidation.issues.slice(0, 3).map(friendlyIssue)

          return (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                if (nextDisabled) return
                if (isLast) { void handleConfirm() } else { setStep(safeStep + 1) }
              }}
            >
              <DialogHeader className="space-y-2 border-b px-6 py-4 text-left">
                <DialogTitle>Create service</DialogTitle>
                <DialogDescription id="wizard-step-description">
                  Step {safeStep + 1} of {visibleSteps.length} — {current?.label}
                </DialogDescription>
                <ol className="flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Steps">
                  {visibleSteps.map((s, index) => (
                    <li
                      key={s.id}
                      aria-current={index === safeStep ? 'step' : undefined}
                      className={index === safeStep ? 'font-medium text-foreground' : index < safeStep ? 'text-muted-foreground' : 'text-muted-foreground/70'}
                    >
                      {index + 1}. {s.label}
                    </li>
                  ))}
                </ol>
              </DialogHeader>

              <div className="max-h-[55vh] overflow-y-auto px-6 py-4">{current?.render({ form, projectId })}</div>

              {nextDisabled && issues.length > 0 ? (
                <ul role="alert" className="space-y-0.5 border-t bg-destructive/5 px-6 py-2 text-sm text-destructive">
                  {issues.map((issue) => (<li key={issue}>{issue}</li>))}
                </ul>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-4">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setStep(safeStep - 1) }} disabled={safeStep === 0 || creating}>
                  <ChevronLeft className="mr-1 size-4" /> Back
                </Button>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={creating}>
                    Cancel
                  </Button>
                  {!isLast
                    ? <Button type="submit" size="sm" disabled={nextDisabled}>Next <ChevronRight className="ml-1 size-4" /></Button>
                    : <Button type="submit" size="sm" disabled={creating || nextDisabled}>
                      {creating ? 'Creating…' : 'Create service'}
                    </Button>}
                </div>
              </div>
            </form>
          )
        }} />
      </DialogContent>
    </Dialog>
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
