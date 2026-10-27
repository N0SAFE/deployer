'use client'

import { Input } from '@deployer/ui/components/shadcn/input'
import { Field, FieldLabel, FieldDescription } from '@deployer/ui/components/shadcn/field'
import type { CreateServiceFormApi, RunnerFormData } from '../../CreateService.hook'
import type { useRunnerDetection } from '../runner-detection-context'
import { AutocompleteField } from '../autocomplete-field'
import { RequiredError } from '../required-error'
import { NumberField } from './primitives'
import { RequiredInput } from './RequiredInput'
import { OrchestratorFields } from './OrchestratorFields'
import { ComposeStackFields } from './ComposeStackFields'
import { MockRunnerFields } from './MockRunnerFields'

const Req = () => <span className="text-destructive" aria-hidden="true"> *</span>

export function RunnerSpecificFields({ form, runnerId, hints }: {
  form: CreateServiceFormApi
  runnerId: RunnerFormData['runnerId']
  hints: ReturnType<typeof useRunnerDetection>['hints']
}) {
  switch (runnerId) {
    case 'manual':
      return (
        <form.Field name="runner.config.startCommand" children={(f) => (
          <Field data-invalid={(f.state.meta.isTouched && !(f.state.value ?? '').trim()) || undefined}>
            <FieldLabel>Start command<Req /></FieldLabel>
            <AutocompleteField
              value={f.state.value ?? ''}
              onChange={(v) => { f.handleChange(v) }}
              onClose={f.handleBlur}
              options={['npm start', 'npm run start', 'yarn start', 'pnpm start', 'bun start', 'node server.js', 'node index.js', 'python main.py', 'uvicorn main:app --host 0.0.0.0', 'gunicorn app:app --bind 0.0.0.0:8000', 'go run .', 'cargo run']}
              placeholder="npm start"
              detected={hints?.startCommand}
            />
            <FieldDescription>The command that starts your app inside the container.</FieldDescription>
            <RequiredError touched={f.state.meta.isTouched} value={f.state.value ?? ''} message="Enter the command that starts your app." />
          </Field>
        )} />
      )
    case 'orchestrator':
      return <OrchestratorFields form={form} hints={hints} />
    case 'compose':
      return <ComposeStackFields form={form} hints={hints} />
    case 'kubernetes':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.namespace" children={(f) => (
            <Field>
              <FieldLabel>Namespace<Req /></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} onClose={f.handleBlur} options={['default', 'production', 'staging', 'development']} placeholder="default" />
              <FieldDescription>The Kubernetes namespace the workload is created in.</FieldDescription>
              <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter a namespace." />
            </Field>
          )} />
          <form.Field name="runner.config.deploymentName" children={(f) => (
            <Field>
              <FieldLabel>Deployment name<Req /></FieldLabel>
              <RequiredInput value={f.state.value} onChange={(v) => { f.handleChange(v) }} onBlur={f.handleBlur} touched={f.state.meta.isTouched} message="Enter a deployment name." placeholder="my-service" />
            </Field>
          )} />
          <form.Field name="runner.config.replicas" children={(f) => (
            <Field>
              <FieldLabel>Replicas</FieldLabel>
              <NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['1', '2', '3', '5', '10']} placeholder="1" />
              <FieldDescription>How many identical copies run in parallel.</FieldDescription>
            </Field>
          )} />
          <form.Field name="runner.config.serviceAccountName" children={(f) => (
            <Field><FieldLabel>Service account</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="default" /></Field>
          )} />
        </div>
      )
    case 'nomad':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.jobName" children={(f) => (
            <Field>
              <FieldLabel>Job name<Req /></FieldLabel>
              <RequiredInput value={f.state.value} onChange={(v) => { f.handleChange(v) }} onBlur={f.handleBlur} touched={f.state.meta.isTouched} message="Enter a job name." placeholder="my-service" />
            </Field>
          )} />
          <form.Field name="runner.config.datacenter" children={(f) => (
            <Field>
              <FieldLabel>Datacenter<Req /></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} onClose={f.handleBlur} options={['dc1', 'dc2', 'dc3']} placeholder="dc1" />
              <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter a datacenter." />
            </Field>
          )} />
          <form.Field name="runner.config.nomadNamespace" children={(f) => (
            <Field><FieldLabel>Nomad namespace</FieldLabel><Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="default" /></Field>
          )} />
        </div>
      )
    case 'worker-runtime':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.queueName" children={(f) => (
            <Field>
              <FieldLabel>Queue name<Req /></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} onClose={f.handleBlur} options={['default', 'jobs', 'emails', 'events']} placeholder="my-queue" />
              <FieldDescription>The job queue this worker reads from.</FieldDescription>
              <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter a queue name." />
            </Field>
          )} />
          <form.Field name="runner.config.concurrency" children={(f) => (
            <Field>
              <FieldLabel>Concurrency</FieldLabel>
              <NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['1', '2', '5', '10', '50', '100']} placeholder="1" />
              <FieldDescription>Jobs processed at the same time.</FieldDescription>
            </Field>
          )} />
          <form.Field name="runner.config.maxRetries" children={(f) => (
            <Field>
              <FieldLabel>Max retries</FieldLabel>
              <NumberField value={f.state.value} onChange={(v) => { f.handleChange(v) }} options={['0', '1', '3', '5', '10']} placeholder="0" />
              <FieldDescription>How often a failed job is tried again.</FieldDescription>
            </Field>
          )} />
        </div>
      )
    case 'static':
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field name="runner.config.outputDir" children={(f) => (
            <Field>
              <FieldLabel>Output directory<Req /></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} onClose={f.handleBlur} options={['dist', 'build', 'public', 'out', './dist']} placeholder="dist" detected={hints?.outputDir} />
              <FieldDescription>The folder produced by your build that gets served.</FieldDescription>
              <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter the output directory." />
            </Field>
          )} />
          <form.Field name="runner.config.indexFile" children={(f) => (
            <Field>
              <FieldLabel>Index file<Req /></FieldLabel>
              <AutocompleteField value={f.state.value} onChange={(v) => { f.handleChange(v) }} onClose={f.handleBlur} options={['index.html', '200.html', 'index.htm']} placeholder="index.html" detected={hints?.indexFile} />
              <FieldDescription>The page served at the root of the site.</FieldDescription>
              <RequiredError touched={f.state.meta.isTouched} value={f.state.value} message="Enter the index file." />
            </Field>
          )} />
          <form.Field name="runner.config.errorPage" children={(f) => (
            <Field>
              <FieldLabel>Error page</FieldLabel>
              <Input value={f.state.value} onChange={(e) => { f.handleChange(e.target.value) }} placeholder="404.html" />
              <FieldDescription>Optional page shown when a file is not found.</FieldDescription>
            </Field>
          )} />
        </div>
      )
    case 'mock':
      return <MockRunnerFields form={form} />
  }
}
