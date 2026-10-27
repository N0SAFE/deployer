'use client'

import { useState } from 'react'
import { TagInput } from 'emblor'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Textarea } from '@deployer/ui/components/shadcn/textarea'
import { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldSet, FieldLegend } from '@deployer/ui/components/shadcn/field'
import type { CreateServiceFormApi } from '../CreateService.hook'
import { RequiredError } from './required-error'

/* ─── TagField wrapper ─── */
function TagField({ value, onChange }: { value: string[]; onChange: (next: string[]) => void }) {
  const [activeTagIndex, setActiveTagIndex] = useState<number | null>(null)
  const tags: { id: string; text: string }[] = value.map((t, i) => ({ id: String(i), text: t }))
  return (
    <TagInput
      activeTagIndex={activeTagIndex}
      setActiveTagIndex={setActiveTagIndex}
      tags={tags}
      setTags={(newTags) => { onChange((typeof newTags === 'function' ? newTags(tags) : newTags).map((t) => t.text)) }}
      placeholder="Add a tag…"
      delimiterList={[',']}
      addOnPaste
      addTagsOnBlur
    />
  )
}

export function StepBasicInfo({ form }: { form: CreateServiceFormApi }) {
  return (
    <FieldSet>
      <FieldLegend>Service details</FieldLegend>
      <FieldDescription>Name your service. Where its code comes from and how it runs are set in the next steps.</FieldDescription>
      <FieldGroup>
        <form.Field name="basicInfo.name" children={(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field data-invalid={isInvalid || undefined}>
              <FieldLabel>Service name <span className="text-destructive">*</span></FieldLabel>
              <Input value={field.state.value} onBlur={field.handleBlur} onChange={(e) => { field.handleChange(e.target.value) }} aria-invalid={isInvalid || undefined} placeholder="api-gateway" />
              <FieldDescription>Shown across the dashboard. Pick something your team will recognise.</FieldDescription>
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
              {!isInvalid && <RequiredError touched={field.state.meta.isTouched} value={field.state.value} message="Give the service a name." />}
            </Field>
          )
        }} />
        <form.Field name="basicInfo.description" children={(field) => (
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea value={field.state.value ?? ''} onBlur={field.handleBlur} onChange={(e) => { field.handleChange(e.target.value) }} placeholder="What does this service do?" className="min-h-20 resize-y" />
          </Field>
        )} />
        <form.Field name="basicInfo.tags" children={(field) => (
          <Field>
            <FieldLabel>Tags</FieldLabel>
            <TagField value={field.state.value ?? []} onChange={(next) => { field.handleChange(next) }} />
            <FieldDescription>Tags for organizing and filtering services.</FieldDescription>
          </Field>
        )} />
      </FieldGroup>
    </FieldSet>
  )
}
