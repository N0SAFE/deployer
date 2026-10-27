'use client'

import { useState } from 'react'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@deployer/ui/components/shadcn/collapsible'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import { Sparkles, ChevronDown, Loader2 } from 'lucide-react'
import type { CreateServiceFormApi } from '../../CreateService.hook'
import { githubAppEndpoints } from '@/domains/github-apps/endpoints'
import { useRunnerDetection } from '../runner-detection-context'
import { subServicesFromHints } from '../runner-presets'
import { AutocompleteField } from '../autocomplete-field'
import { SearchableSelect } from '../searchable-select'
import { RequiredError } from '../required-error'
import { KeyValueEditor, TagsInput } from './primitives'
import { SubServiceEditor } from './SubServiceEditor'

/** Orchestrator fields: compose file + cascade env + sub-services. */
export function OrchestratorFields({ form, hints }: {
  form: CreateServiceFormApi
  hints: ReturnType<typeof useRunnerDetection>['hints']
}) {
  const { source, setDetection } = useRunnerDetection()
  const [redetecting, setRedetecting] = useState(false)

  const handleComposeChange = async (path: string) => {
    form.setFieldValue('runner.config.composeFile', path)
    if (!source) return
    // Re-detect sub-services for the newly selected compose file and replace
    // the existing sub-services with the auto-detected ones.
    setRedetecting(true)
    try {
      const result = await githubAppEndpoints.detectRunner.call({
        params: { owner: source.owner, repo: source.repo },
        query: { providerAppId: source.appId, composeFile: path },
      })
      const newHints = result.detected[0]?.config ?? null
      if (newHints) {
        setDetection(result.defaultBuilder ?? result.detected[0]?.builderId ?? null, newHints)
        form.setFieldValue('runner.config.subServices', subServicesFromHints(newHints.composeServices))
      }
    } catch {
      // best-effort: keep current sub-services on failure
    } finally {
      setRedetecting(false)
    }
  }

  const candidates = (hints?.composeCandidates ?? []).map((c) => ({
    value: c.path,
    label: c.path,
    badge: c.kind,
  }))

  return (
    <div className="space-y-3">
      {/* Compose file — fluent select over detected candidates; switching re-detects sub-services */}
      <form.Field name="runner.config.composeFile" children={(f) => (
        <Field>
          <FieldLabel>Compose file <span className="text-destructive">*</span></FieldLabel>
          {candidates.length > 1 ? (
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SearchableSelect
                  value={f.state.value}
                  onChange={(v) => { void handleComposeChange(v) }}
                  options={candidates}
                  placeholder="docker-compose.yml"
                  searchPlaceholder="Type to search compose files…"
                  emptyMessage="No compose file matches."
                  allowCustom
                  onClose={f.handleBlur}
                />
              </div>
              {redetecting && <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />}
            </div>
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
          {candidates.length > 1 && (
            <FieldDescription>
              {String(candidates.length)} compose files found in the repo — prod preferred. Switching re-detects the sub-services.
            </FieldDescription>
          )}
        </Field>
      )} />
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="runner.config.composeProjectName" children={(f) => (
          <Field><FieldLabel>Project name</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="my-project" /><FieldDescription>Optional name prefix for the containers and networks of this stack.</FieldDescription></Field>
        )} />
        <form.Field name="runner.config.profiles" children={(f) => (
          <Field><FieldLabel>Profiles</FieldLabel><TagsInput value={f.state.value ?? []} onChange={(v) => { f.handleChange(v) }} placeholder="prod, cache" /><FieldDescription>Optional compose profiles to enable, separated by commas.</FieldDescription></Field>
        )} />
      </div>

      {/* ── Self-deploy + preview scope ── */}
      <div className="grid gap-3 sm:grid-cols-2">
        <form.Field name="runner.config.autoDeploySubtree" children={(f) => (
          <Field>
            <FieldLabel>Self-deploy scope</FieldLabel>
            <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'whole-stack' | 'changed-only') }}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whole-stack">Whole stack — push deploys parent + all children</SelectItem>
                <SelectItem value="changed-only">Changed only — push deploys affected services</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>What a push to this repo deploys (GitHub paths-filter style).</FieldDescription>
          </Field>
        )} />
        <form.Field name="runner.config.previewScope" children={(f) => (
          <Field>
            <FieldLabel>Preview scope</FieldLabel>
            <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'whole-stack' | 'changed-only') }}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whole-stack">Whole stack — PR previews the full product</SelectItem>
                <SelectItem value="changed-only">Changed only — PR previews touched services</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>What a PR preview of this orchestrator includes.</FieldDescription>
          </Field>
        )} />
      </div>

      {/* ── Hierarchy note (collapsed by default) ── */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1 text-xs text-muted-foreground">
            <Sparkles className="size-3 text-primary" /> How sub-services relate to this service
            <ChevronDown className="size-3" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="text-xs text-muted-foreground">
          The orchestrator is only a wrapper around your compose file. Ports, visibility and domains are set on each sub-service below.
          Environment variables set here cascade into every sub-service; a sub-service&apos;s own value overrides them.
        </CollapsibleContent>
      </Collapsible>

      {/* ── Main (cascaded) environment ── */}
      <form.Field name="runner.config.environment" children={(f) => (
        <Field>
          <FieldLabel>Environment variables shared by all sub-services</FieldLabel>
          <KeyValueEditor
            value={f.state.value ?? {}}
            onChange={(v) => { f.handleChange(v) }}
            keyPlaceholder="KEY"
            valuePlaceholder="value"
          />
        </Field>
      )} />

      <SubServiceEditor form={form} />
    </div>
  )
}
