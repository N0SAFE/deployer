'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import { useRunnerDetection } from './runner-detection-context'
import type { CreateServiceFormApi } from '../CreateService.hook'
import { Section } from './step-section'

function TagsInput({ value, onChange, placeholder }: {
  value: string[]
  onChange: (v: string[]) => void
  placeholder?: string
}) {
  return (
    <Input
      value={value.join(', ')}
      onChange={(e) => { onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean)) }}
      placeholder={placeholder}
    />
  )
}

function NumberField({ value, onChange, options, placeholder }: {
  value: number
  onChange: (v: number) => void
  options: readonly string[]
  placeholder?: string
}) {
  const current = String(value)
  const all = options.includes(current) ? [...options] : [current, ...options]
  return (
    <Select value={current} onValueChange={(v) => { onChange(Number(v)) }}>
      <SelectTrigger><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {all.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
      </SelectContent>
    </Select>
  )
}


/**
 * Step 5 — Runtime. Shared execution fields for container-style runners
 * (manual, kubernetes, nomad, worker-runtime). The orchestrator and static
 * runners declare their process differently (manifest / static serving) and
 * are skipped.
 */
export function StepRuntime({ form }: { form: CreateServiceFormApi }) {
  const { hints } = useRunnerDetection()

  return (
    <form.Subscribe
      selector={(s) => ({ runnerId: s.values.runner.runnerId })}
      children={({ runnerId }) => {
        const isContainerRunner = (['manual', 'kubernetes', 'nomad', 'worker-runtime'] as const).includes(runnerId as never)

        return (
          <div className="space-y-4">
            {!isContainerRunner ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {runnerId === 'orchestrator'
                  ? 'Runtime is defined by the compose manifest and its sub-services — nothing to configure here.'
                  : 'Static sites serve files directly — configure output paths in the Runner step.'}
              </div>
            ) : (<>
              {/* Ports & storage */}
              <Section title="Ports & storage" description="Exposed ports, volumes and secrets for the deployed service.">
                <div className="grid gap-3 sm:grid-cols-2">
                  <form.Field name="runner.config.ports" children={(f) => (
                    <Field>
                      <FieldLabel>Ports</FieldLabel>
                      <TagsInput value={(f.state.value as string[] | undefined) ?? []} onChange={(v) => { f.handleChange(v.map(Number)) }} placeholder="3000, 8080" />
                      <FieldDescription>Ports your app listens on, separated by commas.</FieldDescription>
                      {hints?.ports && hints.ports.length > 0 ? <FieldDescription>Detected: {hints.ports.join(', ')}</FieldDescription> : null}
                    </Field>
                  )} />
                  <form.Field name="runner.config.args" children={(f) => (
                    <Field><FieldLabel>CLI arguments</FieldLabel><TagsInput value={(f.state.value) ?? []} onChange={(v) => { f.handleChange(v) }} placeholder="--port, --verbose" /><FieldDescription>Extra arguments appended to the start command, separated by commas.</FieldDescription></Field>
                  )} />
                  <form.Field name="runner.config.volumeMounts" children={(f) => (
                    <Field><FieldLabel>Volume mounts</FieldLabel><TagsInput value={(f.state.value) ?? []} onChange={(v) => { f.handleChange(v) }} placeholder="/data:/app/data" /><FieldDescription>Persistent storage as host-path:container-path, separated by commas.</FieldDescription></Field>
                  )} />
                  <form.Field name="runner.config.secretRefs" children={(f) => (
                    <Field><FieldLabel>Secret references</FieldLabel><TagsInput value={(f.state.value) ?? []} onChange={(v) => { f.handleChange(v) }} placeholder="db-password, api-key" /><FieldDescription>Names of stored secrets to inject into the container.</FieldDescription></Field>
                  )} />
                </div>
              </Section>

              {/* Deployment policy */}
              <Section title="Deployment" description="Rollout strategy, networking and shutdown behavior.">
                <div className="grid gap-3 sm:grid-cols-3">
                  <form.Field name="runner.config.strategy" children={(f) => (
                    <Field>
                      <FieldLabel>Rollout strategy</FieldLabel>
                      <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as never) }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['rolling', 'recreate', 'blue-green', 'canary'] as const).map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>How a new version replaces the old one: rolling swaps gradually, recreate stops then starts, blue-green and canary switch traffic after the new version is up.</FieldDescription>
                    </Field>
                  )} />
                  <form.Field name="runner.config.networkMode" children={(f) => (
                    <Field>
                      <FieldLabel>Network mode</FieldLabel>
                      <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as never) }}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(['bridge', 'host', 'overlay'] as const).map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <FieldDescription>Docker network type. Bridge is right for almost every service.</FieldDescription>
                    </Field>
                  )} />
                  <form.Field name="runner.config.gracefulShutdownSeconds" children={(f) => (
                    <Field>
                      <FieldLabel>Graceful shutdown (s)</FieldLabel>
                      <NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['10', '30', '60', '120', '300']} placeholder="30" />
                      <FieldDescription>Seconds the container gets to finish its work after a stop request.</FieldDescription>
                    </Field>
                  )} />
                </div>
              </Section>
            </>)}
          </div>
        )
      }}
    />
  )
}
