'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import { Layers } from 'lucide-react'
import type { CreateServiceFormApi } from '../../CreateService.hook'
import type { useRunnerDetection } from '../runner-detection-context'
import { AutocompleteField } from '../autocomplete-field'
import { SearchableSelect } from '../searchable-select'
import { RequiredError } from '../required-error'
import { KeyValueEditor, TagsInput } from './primitives'

/**
 * Compose STACK — ONE service managing a docker-compose stack as a single
 * unit. `docker compose up/down/logs` run against the whole stack. There is
 * no per-service lifecycle control; the declared services are read-only
 * references (you can still update image/env via the compose file, but the
 * service deploys as one unit).
 */
export function ComposeStackFields({ form, hints }: {
  form: CreateServiceFormApi
  hints: ReturnType<typeof useRunnerDetection>['hints']
}) {
  const candidates = (hints?.composeCandidates ?? []).map((c) => ({
    value: c.path,
    label: c.path,
    badge: c.kind,
  }))

  return (
    <div className="space-y-3">
      <form.Field name="runner.config.composeFile" children={(f) => (
        <Field>
          <FieldLabel>Compose file <span className="text-destructive">*</span></FieldLabel>
          {candidates.length > 1 ? (
            <SearchableSelect
              value={f.state.value}
              onChange={(v) => { f.handleChange(v) }}
              options={candidates}
              placeholder="docker-compose.yml"
              searchPlaceholder="Type to search compose files…"
              emptyMessage="No compose file matches."
              allowCustom
            />
          ) : (
            <AutocompleteField
              value={f.state.value}
              onChange={(v) => { f.handleChange(v) }}
              onClose={f.handleBlur}
              options={['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'docker-compose.prod.yml']}
              placeholder="docker-compose.yml"
              detected={hints?.composeFile}
            />
          )}
          <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter the path of the compose file." />
          <FieldDescription>
            This service deploys the <strong>whole stack</strong> as one unit — up/down/logs run on all
            services together. For per-service control, switch the runner to&nbsp;
            <strong>Sub-services</strong>.
          </FieldDescription>
        </Field>
      )} />
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="runner.config.appName" children={(f) => (
          <Field>
            <FieldLabel>Compose project name <span className="text-destructive">*</span></FieldLabel>
            <Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} onBlur={f.handleBlur} placeholder="my-stack" aria-invalid={(f.state.meta.isTouched && !f.state.value.trim()) || undefined} />
            <FieldDescription>Names the stack (docker compose -p). Containers and networks are prefixed with it.</FieldDescription>
            <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter a project name for the stack." />
          </Field>
        )} />
        <form.Field name="runner.config.profiles" children={(f) => (
          <Field><FieldLabel>Profiles</FieldLabel><TagsInput value={f.state.value ?? []} onChange={(v) => { f.handleChange(v) }} placeholder="prod, cache" /><FieldDescription>Optional compose profiles to enable, separated by commas.</FieldDescription></Field>
        )} />
      </div>

      {/* ── Declared services (read-only refs) ── */}
      <form.Field name="runner.config.declaredServices" children={(f) => {
        const declared = (f.state.value as { name: string; image?: string; ports?: string[] }[] | undefined) ?? []
        return (
          <Field>
            <FieldLabel>Services in this stack</FieldLabel>
            <FieldDescription>
              Detected from the compose file. They are managed as a single unit — switch to
              Sub-services to give each one its own lifecycle and dependency graph.
            </FieldDescription>
            {declared.length === 0 ? (
              <p className="text-xs text-muted-foreground">No services detected yet — pick a compose file above.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {declared.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 rounded-md border bg-background/40 px-2.5 py-1.5 text-xs">
                    <Layers className="size-3 shrink-0 text-muted-foreground" />
                    <span className="truncate font-medium">{s.name}</span>
                    <span className="flex-1" />
                    {s.image ? <code className="truncate font-mono text-xs text-muted-foreground">{s.image}</code> : null}
                    {s.ports && s.ports.length > 0 ? <Badge variant="outline" className="text-xs">{s.ports.join(', ')}</Badge> : null}
                  </div>
                ))}
              </div>
            )}
          </Field>
        )
      }} />

      {/* ── Stack environment ── */}
      <form.Field name="runner.config.environment" children={(f) => (
        <Field>
          <FieldLabel>Stack environment</FieldLabel>
          <FieldDescription>Environment overrides passed to the whole compose stack.</FieldDescription>
          <KeyValueEditor
            value={f.state.value ?? {}}
            onChange={(v) => { f.handleChange(v) }}
            keyPlaceholder="KEY"
            valuePlaceholder="value"
          />
        </Field>
      )} />
    </div>
  )
}
