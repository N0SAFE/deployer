'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Alert, AlertDescription, AlertTitle } from '@deployer/ui/components/shadcn/alert'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import { Check, Sparkles, Container } from 'lucide-react'
import { cn } from '@deployer/ui/lib/utils'
import type { CreateServiceFormApi } from '../CreateService.hook'
import { useRunnerDetection } from './runner-detection-context'
import { AutocompleteField } from './autocomplete-field'
import { BUILD_METHOD_META, type BuildMethod } from './runner-presets'
import { Section } from './step-section'

const ROOT_PATH_PRESETS = ['/', './apps/web', './apps/api', './packages/app', './client', './server', './src'] as const
const BUILD_CONTEXT_PRESETS = ['.', './src', './apps/web', './packages/app', './client', './server', '../..'] as const
const DOCKERFILE_PRESETS = ['Dockerfile', './Dockerfile', 'docker/Dockerfile', 'build/Dockerfile', 'Dockerfile.prod', 'Dockerfile.dev'] as const
const COMPOSE_PRESETS = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml', 'docker-compose.prod.yml'] as const

/** Compact single-line picker for the build method. */
function BuildMethodPicker({ value, onChange }: { value: BuildMethod; onChange: (v: BuildMethod) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-3">
      {BUILD_METHOD_META.map((opt) => {
        const Icon = opt.icon
        const selected = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => { onChange(opt.value) }}
            className={cn(
              'flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-all',
              selected
                ? 'border-primary bg-primary/10 ring-1 ring-primary'
                : 'border-border bg-background/40 hover:border-primary/40 hover:bg-muted/40',
            )}
          >
            <Icon className={cn('mt-0.5 size-3.5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">{opt.label}</span>
              <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{opt.description}</span>
            </span>
            {selected && <Check className="ml-auto size-3 shrink-0 text-primary" />}
          </button>
        )
      })}
    </div>
  )
}


/**
 * Step 3 — Builder. How the container image is produced from the source.
 * Pure build concerns only (no runner/deploy fields here).
 */
export function StepBuilder({ form }: { form: CreateServiceFormApi }) {
  const { hints } = useRunnerDetection()

  return (
    <form.Subscribe
      selector={(s) => ({ method: s.values.runner.build.method })}
      children={({ method }) => (
        <div className="space-y-4">
          {/* Detection hint — compact one-liner */}
          {hints && (
            <Alert className="border-primary/30 bg-primary/5 py-2">
              <Sparkles className="size-3.5 text-primary" />
              <AlertTitle className="text-xs">Build detection</AlertTitle>
              <AlertDescription className="text-xs">
                {[
                  hints.language ? `Language: ${hints.language}` : null,
                  hints.framework ? `Framework: ${hints.framework}` : null,
                  hints.packageManager ? `PM: ${hints.packageManager}` : null,
                  hints.nodeVersion ? `Node ${hints.nodeVersion}` : null,
                  hints.dockerfilePath ? `Dockerfile: ${hints.dockerfilePath}` : null,
                  hints.composeFile ? `Compose: ${hints.composeFile}` : null,
                ].filter(Boolean).join(' · ') || 'No build hints detected.'}
              </AlertDescription>
            </Alert>
          )}

          {/* Build method */}
          <Section title="Build method" description="The builder turns your source code into a container image that the runner then starts. Auto-detect is a safe default.">
            <form.Field name="runner.build.method" children={(f) => (
              <BuildMethodPicker value={f.state.value} onChange={(v) => { f.handleChange(v) }} />
            )} />
          </Section>

          {method === 'external' ? (
            <Alert>
              <Container className="size-4" />
              <AlertTitle className="text-xs">No build step</AlertTitle>
              <AlertDescription className="text-xs">
                The container image reference comes from the Source step — nothing is built on the node.
              </AlertDescription>
            </Alert>
          ) : (
            <Section title="Build configuration" description="Paths and commands used to produce the image.">
              <div className="grid gap-3 sm:grid-cols-2">
                <form.Field name="runner.build.rootPath" children={(f) => (
                  <Field>
                    <FieldLabel>Root path</FieldLabel>
                    <AutocompleteField
                      value={(f.state.value) ?? ''}
                      onChange={(v) => { f.handleChange(v) }}
                      options={ROOT_PATH_PRESETS}
                      placeholder="/"
                      detected={hints?.rootPath}
                    />
                    <FieldDescription>Folder of the repository that contains your app (use / for the whole repo, or a sub-folder in a monorepo).</FieldDescription>
                  </Field>
                )} />
                <form.Field name="runner.build.buildContext" children={(f) => (
                  <Field>
                    <FieldLabel>Build context</FieldLabel>
                    <AutocompleteField
                      value={(f.state.value) ?? ''}
                      onChange={(v) => { f.handleChange(v) }}
                      options={BUILD_CONTEXT_PRESETS}
                      placeholder="."
                      detected={hints?.buildContext}
                    />
                    <FieldDescription>Folder sent to the build, relative to the root path.</FieldDescription>
                  </Field>
                )} />
                {method === 'dockerfile' && (
                  <form.Field name="runner.build.dockerfilePath" children={(f) => (
                    <Field>
                      <FieldLabel>Dockerfile path</FieldLabel>
                      <AutocompleteField
                        value={(f.state.value) ?? ''}
                        onChange={(v) => { f.handleChange(v) }}
                        options={DOCKERFILE_PRESETS}
                        placeholder="Dockerfile"
                        detected={hints?.dockerfilePath}
                      />
                      <FieldDescription>Location of the Dockerfile in the repository.</FieldDescription>
                    </Field>
                  )} />
                )}
                {method === 'dockerfile' && (
                  <form.Field name="runner.build.composeFile" children={(f) => (
                    <Field>
                      <FieldLabel>Compose file (optional)</FieldLabel>
                      <AutocompleteField
                        value={(f.state.value) ?? ''}
                        onChange={(v) => { f.handleChange(v) }}
                        options={COMPOSE_PRESETS}
                        placeholder="docker-compose.yml"
                        detected={hints?.composeFile}
                      />
                      <FieldDescription>Optional path to a compose file in the repository, kept as a reference.</FieldDescription>
                    </Field>
                  )} />
                )}
                {(method === 'nixpacks' || method === 'buildpack' || method === 'railpack') && (<>
                  <form.Field name="runner.build.buildCommand" children={(f) => (
                    <Field>
                      <FieldLabel>Build command</FieldLabel>
                      <Input value={(f.state.value) ?? ''} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="npm run build" />
                      <FieldDescription>Optional. The command that compiles your app during the build.</FieldDescription>
                    </Field>
                  )} />
                  <form.Field name="runner.build.runCommand" children={(f) => (
                    <Field>
                      <FieldLabel>Run command</FieldLabel>
                      <Input value={(f.state.value) ?? ''} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="npm start" />
                      <FieldDescription>Optional. The command the container runs to start your app.</FieldDescription>
                    </Field>
                  )} />
                </>)}
              </div>
            </Section>
          )}
        </div>
      )}
    />
  )
}
