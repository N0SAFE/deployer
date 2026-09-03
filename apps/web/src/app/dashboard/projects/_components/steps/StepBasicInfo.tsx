'use client'

import { useState } from 'react'
import { TagInput } from 'emblor'
import { Input } from '@repo/ui/components/shadcn/input'
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import { Field, FieldLabel, FieldDescription, FieldError, FieldGroup, FieldSet, FieldLegend } from '@repo/ui/components/shadcn/field'
import type { CreateServiceFormApi } from '../CreateService.hook'

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
      <FieldDescription>Define the basic identity of your service.</FieldDescription>
      <FieldGroup>
        <form.Field name="basicInfo.name" children={(field) => {
          const isInvalid = field.state.meta.isTouched && !field.state.meta.isValid
          return (
            <Field data-invalid={isInvalid || undefined}>
              <FieldLabel>Service name <span className="text-destructive">*</span></FieldLabel>
              <Input value={field.state.value} onBlur={field.handleBlur} onChange={(e) => { field.handleChange(e.target.value) }} aria-invalid={isInvalid || undefined} placeholder="api-gateway" />
              {isInvalid && <FieldError errors={field.state.meta.errors} />}
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
