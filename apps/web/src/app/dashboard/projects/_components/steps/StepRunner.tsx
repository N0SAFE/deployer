'use client'

import { Button } from '@deployer/ui/components/shadcn/button'
import { Layers, ShipWheel } from 'lucide-react'
import type { CreateServiceFormApi } from '../CreateService.hook'
import { useRunnerDetection } from './runner-detection-context'
import { RUNNER_DEFAULT_CONFIG, subServicesFromHints } from './runner-presets'
import { DetectionSummary } from './runner/DetectionSummary'
import { RunnerSpecificFields } from './runner/RunnerSpecificFields'
import { RunnerTypePicker } from './runner/RunnerTypePicker'
import { Section } from './step-section'
import { configForRunnerSwitch } from './runner/runner-switch'

export function StepRunner({ form }: { form: CreateServiceFormApi }) {
  const { builderId, hints } = useRunnerDetection()

  return (
    <form.Subscribe
      selector={(s) => ({ runnerId: s.values.runner.runnerId })}
      children={({ runnerId }) => (
        <div className="space-y-4">
          <DetectionSummary hints={hints} builderId={builderId} />

          {/* ── Compose mode prompt: one stack vs sub-services ── */}
          {hints?.composeServices && hints.composeServices.length > 1 && runnerId === 'compose' && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="flex items-start gap-2">
                <Layers className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    Detected {String(hints.composeServices.length)} services in this compose file
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Currently the whole stack deploys as <strong>one service</strong> (up/down/logs
                    together). Want each service managed individually with its own dependency graph?
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={() => {
                      form.setFieldValue('runner.runnerId', 'orchestrator')
                      form.setFieldValue('runner.config', {
                        ...RUNNER_DEFAULT_CONFIG.orchestrator,
                        composeFile: hints.composeFile ?? 'docker-compose.yml',
                        subServices: subServicesFromHints(hints.composeServices),
                      })
                    }}>
                      <Layers className="size-3.5" /> Manage as sub-services
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => {
                      const detected = hints.composeServices
                      if (!detected) return
                      form.setFieldValue('runner.config.declaredServices',
                        detected.map((s) => ({ name: s.name, image: s.image, ports: (s.ports ?? []).map(String) })))
                    }}>
                      <ShipWheel className="size-3.5" /> Keep as one stack
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <Section
            title="Runner type"
            description="The runner decides how your built image is started and kept running (a single container, a compose stack, Kubernetes, static files…). If you are unsure, keep Manual container."
          >
            <form.Field name="runner.runnerId" children={(f) => (
              <RunnerTypePicker
                value={f.state.value}
                onChange={(v) => {
                  const current = form.state.values.runner
                  // Re-selecting the same runner keeps the config (e.g. detected sub-services).
                  const config = configForRunnerSwitch(
                    current.runnerId,
                    current.config,
                    v,
                    hints?.composeServices ?? [],
                  )
                  if (!config) return
                  f.handleChange(v)
                  form.setFieldValue('runner', { ...current, runnerId: v, config } as never)
                }}
              />
            )} />
          </Section>

          <Section title="Runner configuration" description="Settings specific to the runner type chosen above. Fields marked * are required.">
            <RunnerSpecificFields form={form} runnerId={runnerId} hints={hints} />
          </Section>
        </div>
      )}
    />
  )
}
