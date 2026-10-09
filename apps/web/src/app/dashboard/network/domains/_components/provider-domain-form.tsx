'use client'

import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { Button } from '@repo/ui/components/shadcn/button'
import { Checkbox } from '@repo/ui/components/shadcn/checkbox'
import { DialogFooter } from '@repo/ui/components/shadcn/dialog'
import { Field, FieldDescription, FieldLabel } from '@repo/ui/components/shadcn/field'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { useAddProjectDomain } from '@/domains/domain/hooks'
import { useCloudflareCreateRecord, useCloudflareZones, useDNSProviders } from '@/domains/dns-providers/hooks'
import { isDefinedORPCError, getErrorMessage, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import type { VerificationMethod } from './domain-types'

const PROVIDER_TYPES: readonly { value: string; label: string }[] = [
  { value: 'cloudflare', label: 'Cloudflare' },
  { value: 'route53', label: 'AWS Route53' },
  { value: 'google-dns', label: 'Google Cloud DNS' },
]

/**
 * Add a domain through a connected DNS provider account. Only Cloudflare can
 * create the verification record automatically today; the other types add the
 * domain and leave the record to you.
 */
export function ProviderDomainForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const addDomain = useAddProjectDomain()
  const createRecord = useCloudflareCreateRecord()
  const { data: providersData } = useDNSProviders()
  const providers = providersData?.providers ?? []
  const [account, setAccount] = useState('')
  const [providerType, setProviderType] = useState('')
  const { data: zonesData } = useCloudflareZones(account)
  const zones = zonesData?.zones ?? []
  const zonesError = zonesData?.error ?? null

  const form = useForm({
    defaultValues: { domain: '', providerType: '', providerId: '', zoneId: '', recordType: 'txt_record' as VerificationMethod, autoDns: true },
    onSubmit: async ({ value }) => {
      const domain = value.domain.trim()
      if (domain === '' || value.providerType === '') {
        toast.error('Enter a domain and choose a provider type')
        return
      }
      try {
        const result = (await addDomain.mutateAsync({
          params: { projectId },
          body: { domain, verificationMethod: value.recordType },
        })) as unknown as { verificationInstructions?: { recordName?: string; recordValue?: string } }

        const recordName = result.verificationInstructions?.recordName
        const recordValue = result.verificationInstructions?.recordValue
        let created = false
        if (value.autoDns && account !== '' && value.zoneId !== '' && recordName && recordValue) {
          try {
            await createRecord.mutateAsync({
              params: { providerId: account, zoneId: value.zoneId },
              body: { type: 'TXT', name: recordName, content: recordValue },
            })
            created = true
          } catch (err) {
            toast.warning('Domain added, but the DNS record could not be created', {
              description: isDefinedORPCError(err)
                ? getErrorMessage(err, 'Create the TXT record manually to verify.')
                : UNKNOWN_ORPC_ERROR_MESSAGE,
            })
          }
        }
        toast.success(created ? 'Domain added — DNS record created, verifying' : 'Domain added — add the DNS record, then verify')
        form.reset()
        setAccount('')
        setProviderType('')
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
      <p className="text-sm text-muted-foreground">
        Pick a connected DNS account to have the verification record created for you. Accounts are connected under
        Settings → Integrations.
      </p>

      <form.Field name="providerType">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="provider-type">DNS provider</FieldLabel>
            <Select
              value={field.state.value}
              onValueChange={(v) => {
                field.handleChange(v)
                setProviderType(v)
              }}
            >
              <SelectTrigger id="provider-type"><SelectValue placeholder="Choose a provider" /></SelectTrigger>
              <SelectContent>
                {PROVIDER_TYPES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>

      {providers.length > 0 ? (
        <form.Field name="providerId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="prov-account">Connected account</FieldLabel>
              <FieldDescription>The API credentials used to edit DNS records for this domain.</FieldDescription>
              <Select
                value={field.state.value}
                onValueChange={(v) => {
                  field.handleChange(v)
                  setAccount(v)
                }}
              >
                <SelectTrigger id="prov-account"><SelectValue placeholder="Choose an account" /></SelectTrigger>
                <SelectContent>
                  {providers.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}
        </form.Field>
      ) : providerType !== '' ? (
        <p className="text-sm text-muted-foreground">
          No DNS account is connected yet, so the record cannot be created automatically. You can still add the domain and
          create the record yourself.
        </p>
      ) : null}

      {providerType === 'cloudflare' && account !== '' ? (
        <form.Field name="zoneId">
          {(field) => (
            <Field>
              <FieldLabel htmlFor="prov-zone">Zone</FieldLabel>
              <FieldDescription>
                Zones this account’s token can edit. Picking one fills the domain; prefix it to register a subdomain
                (app.example.com).
              </FieldDescription>
              <Select
                value={field.state.value}
                onValueChange={(v) => {
                  field.handleChange(v)
                  const zone = zones.find((z) => z.id === v)
                  if (zone) form.setFieldValue('domain', zone.name)
                }}
              >
                <SelectTrigger id="prov-zone"><SelectValue placeholder="Choose a zone" /></SelectTrigger>
                <SelectContent>
                  {zonesError !== null ? <SelectItem value="__none__" disabled>{zonesError}</SelectItem> : null}
                  {zonesError === null && zones.length === 0 ? (
                    <SelectItem value="__none__" disabled>No zones — check the token’s permissions</SelectItem>
                  ) : null}
                  {zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.name} ({z.status})</SelectItem>)}
                </SelectContent>
              </Select>
              {zonesError !== null ? <p className="pt-1 text-xs text-destructive">{zonesError}</p> : null}
            </Field>
          )}
        </form.Field>
      ) : null}

      <form.Field name="domain">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="prov-domain">Domain</FieldLabel>
            <Input id="prov-domain" value={field.state.value} onChange={(e) => { field.handleChange(e.target.value) }} placeholder="example.com" />
          </Field>
        )}
      </form.Field>

      <form.Field name="recordType">
        {(field) => (
          <Field>
            <FieldLabel htmlFor="prov-method">Verification record</FieldLabel>
            <Select value={field.state.value} onValueChange={(v) => { field.handleChange(v as VerificationMethod) }}>
              <SelectTrigger id="prov-method"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="txt_record">TXT record (recommended)</SelectItem>
                <SelectItem value="cname_record">CNAME record</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>

      {providerType === 'cloudflare' ? (
        <form.Field name="autoDns">
          {(field) => (
            <div className="flex items-start gap-2">
              <Checkbox
                id="prov-auto"
                checked={field.state.value}
                onCheckedChange={(checked) => { field.handleChange(checked === true) }}
              />
              <div className="space-y-0.5">
                <FieldLabel htmlFor="prov-auto">Create the verification record automatically</FieldLabel>
                <FieldDescription>Needs an account and a zone above.</FieldDescription>
              </div>
            </div>
          )}
        </form.Field>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button onClick={() => void form.handleSubmit()} disabled={addDomain.isPending}>
          {addDomain.isPending ? 'Adding…' : 'Add domain'}
        </Button>
      </DialogFooter>
    </div>
  )
}
