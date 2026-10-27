'use client'

import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { DialogFooter } from '@deployer/ui/components/shadcn/dialog'
import { Field, FieldDescription, FieldLabel } from '@deployer/ui/components/shadcn/field'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'
import { useAddProjectDomain } from '@/domains/domain/hooks'
import { isDefinedORPCError, getErrorMessage, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import type { VerificationMethod } from './domain-types'

/** Add a domain and create the verification record yourself. */
export function ManualDomainForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const addDomain = useAddProjectDomain()
  const form = useForm({
    defaultValues: { domain: '', method: 'txt_record' as VerificationMethod },
    onSubmit: async ({ value }) => {
      if (!value.domain.trim()) {
        toast.error('Enter a domain name')
        return
      }
      try {
        await addDomain.mutateAsync({
          params: { projectId },
          body: { domain: value.domain.trim(), verificationMethod: value.method },
        })
        toast.success('Domain added — add the DNS record, then verify')
        form.reset()
        onDone()
      } catch (err) {
        toast.error('Could not add the domain', {
          description: isDefinedORPCError(err) ? getErrorMessage(err, 'Unknown error') : UNKNOWN_ORPC_ERROR_MESSAGE,
        })
      }
    },
  })

  return (
    <div className="space-y-4 pt-4">
      <form.Field name="domain">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="manual-domain">Domain</FieldLabel>
            <FieldDescription>The domain or subdomain you want to serve, e.g. app.example.com.</FieldDescription>
            <Input
              id="manual-domain"
              value={field.state.value}
              onChange={(e) => { field.handleChange(e.target.value) }}
              placeholder="example.com"
            />
          </Field>
        )}
      </form.Field>
      <form.Field name="method">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="manual-method">Verification method</FieldLabel>
            <Select value={field.state.value} onValueChange={(v) => { field.handleChange(v as VerificationMethod) }}>
              <SelectTrigger id="manual-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="txt_record">TXT record (recommended)</SelectItem>
                <SelectItem value="cname_record">CNAME record</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              You will create a record under <code className="text-xs">_deployer-verify</code> to prove you own the domain;
              the exact name and value appear in the table after adding.
            </FieldDescription>
          </Field>
        )}
      </form.Field>
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={() => void form.handleSubmit()} disabled={addDomain.isPending}>
          {addDomain.isPending ? 'Adding…' : 'Add domain'}
        </Button>
      </DialogFooter>
    </div>
  )
}
