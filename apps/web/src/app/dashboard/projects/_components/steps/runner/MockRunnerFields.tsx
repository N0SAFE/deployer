'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { Switch } from '@deployer/ui/components/shadcn/switch'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import type { CreateServiceFormApi } from '../../CreateService.hook'
import { RequiredError } from '../required-error'
import { NumberField } from './primitives'

/**
 * MOCK runner — spec-driven replacement of a contract (Prism/WireMock/
 * json-server). The `implements.contractRef` must match the service this mock
 * replaces (DI-style swap validated by the platform).
 */
export function MockRunnerFields({ form }: { form: CreateServiceFormApi }) {
  return (
    <div className="space-y-3">
      <form.Subscribe selector={(s) => (s.values.runner.runnerId === 'mock' ? ((s.values.runner.config as { engine?: 'prism' | 'wiremock' | 'json-server' }).engine ?? 'prism') : 'prism')} children={(engineVal) => {
        const currentEngine = engineVal
        return (
          <div className="space-y-3">
            {/* ── Contract (the interface this mock satisfies) ── */}
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="runner.config.implements.contractRef" children={(f) => (
                <Field>
                  <FieldLabel>Contract ref <span className="text-destructive">*</span></FieldLabel>
                  <Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} onBlur={f.handleBlur} placeholder="api.oas3" className="font-mono" aria-invalid={(f.state.meta.isTouched && !f.state.value.trim()) || undefined} />
                  <FieldDescription>Name of the API contract this mock stands in for. It must match the contract of the service it replaces.</FieldDescription>
                  <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter the contract reference." />
                </Field>
              )} />
              <form.Field name="runner.config.implements.compatibility" children={(f) => (
                <Field>
                  <FieldLabel>Protocol</FieldLabel>
                  <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'http' | 'grpc' | 'events') }}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="http">HTTP</SelectItem>
                      <SelectItem value="grpc">gRPC</SelectItem>
                      <SelectItem value="events">Events</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldDescription>How consumers talk to the mock.</FieldDescription>
                </Field>
              )} />
            </div>

            {/* ── Engine ── */}
            <form.Field name="runner.config.engine" children={(f) => (
              <Field>
                <FieldLabel>Mock engine</FieldLabel>
                <Select value={f.state.value} onValueChange={(v) => { f.handleChange(v as 'prism' | 'wiremock' | 'json-server') }}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prism">Prism (OpenAPI spec → auto responses)</SelectItem>
                    <SelectItem value="wiremock">WireMock (stub mappings)</SelectItem>
                    <SelectItem value="json-server">json-server (fixture file)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )} />

            {/* ── Source (per engine) ── */}
            {currentEngine === 'prism' && (
              <form.Field name="runner.config.source" children={(f) => {
                const source = f.state.value as never as { kind?: string; specPath?: string } | undefined
                return (
                  <Field>
                    <FieldLabel>OpenAPI spec path <span className="text-destructive">*</span></FieldLabel>
                    <Input
                      value={source?.specPath ?? ''}
                      onChange={(e) => { f.handleChange({ kind: 'openapi', specPath: e.target.value } as never) }}
                      placeholder="contracts/api.oas3.yml"
                      className="font-mono"
                    />
                    <FieldDescription>Path to the OpenAPI file in the repository; Prism generates responses from it.</FieldDescription>
                  </Field>
                )
              }} />
            )}
            {currentEngine === 'wiremock' && (
              <form.Field name="runner.config.source" children={(f) => {
                const source = f.state.value as never as { kind?: string; mappingsDir?: string } | undefined
                return (
                  <Field>
                    <FieldLabel>Stub mappings dir <span className="text-destructive">*</span></FieldLabel>
                    <Input
                      value={source?.mappingsDir ?? ''}
                      onChange={(e) => { f.handleChange({ kind: 'stub-dir', mappingsDir: e.target.value } as never) }}
                      placeholder="mocks/mappings"
                      className="font-mono"
                    />
                    <FieldDescription>Folder with the WireMock stub mapping files.</FieldDescription>
                  </Field>
                )
              }} />
            )}
            {currentEngine === 'json-server' && (
              <form.Field name="runner.config.source" children={(f) => {
                const source = f.state.value as never as { kind?: string; dbPath?: string } | undefined
                return (
                  <Field>
                    <FieldLabel>Fixture file path <span className="text-destructive">*</span></FieldLabel>
                    <Input
                      value={source?.dbPath ?? ''}
                      onChange={(e) => { f.handleChange({ kind: 'db-file', dbPath: e.target.value } as never) }}
                      placeholder="mocks/db.json"
                      className="font-mono"
                    />
                    <FieldDescription>JSON file json-server uses as its data.</FieldDescription>
                  </Field>
                )
              }} />
            )}

            {/* ── Behavior ── */}
            <div className="grid gap-3 sm:grid-cols-2">
              <form.Field name="runner.config.behavior.latencyMs" children={(f) => (
                <Field>
                  <FieldLabel>Added latency (ms)</FieldLabel>
                  <NumberField value={f.state.value ?? 0} onChange={(v) => { f.handleChange(v) }} options={['0', '100', '250', '500', '1000']} placeholder="0" />
                </Field>
              )} />
              <form.Field name="runner.config.behavior.failRatePercent" children={(f) => (
                <Field>
                  <FieldLabel>Error rate (%)</FieldLabel>
                  <NumberField value={f.state.value ?? 0} onChange={(v) => { f.handleChange(v) }} options={['0', '1', '5', '10', '25', '50']} placeholder="0" />
                </Field>
              )} />
            </div>

            {/* ── Preview-only toggle ── */}
            <form.Field name="runner.config.previewOnly" children={(f) => (
              <Field>
                <div className="flex items-center gap-2">
                  <Switch checked={f.state.value} onCheckedChange={(c) => { f.handleChange(c) }} />
                  <span className="text-xs text-muted-foreground">Preview only: never deploy this mock to production</span>
                </div>
              </Field>
            )} />
          </div>
        )
      }} />
    </div>
  )
}
