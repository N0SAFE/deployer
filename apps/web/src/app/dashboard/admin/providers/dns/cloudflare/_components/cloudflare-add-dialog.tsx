'use client'

import { useState } from 'react'
import z from 'zod/v4'
import { toast } from 'sonner'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deployer/ui/components/shadcn/dialog'
import { useCreateDNSProvider } from '@/domains/dns-providers/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { FieldHelp } from '../../../_components/field-help'
import { TextField } from '../../../_components/text-field'
import { useSimpleForm } from '../../../_lib/use-simple-form'

const schema = z.object({
  name: z.string().trim().min(1, 'Give this account a name'),
  apiToken: z.string().min(1, 'Paste an API token'),
  accountEmail: z.union([z.literal(''), z.email('Not a valid email address')]),
})

/** First-run connect flow: where to get the token, which permissions, verified before anything is saved. */
export function CloudflareAddDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createProvider = useCreateDNSProvider()
  const form = useSimpleForm(schema, { name: '', apiToken: '', accountEmail: '' })
  const [failure, setFailure] = useState<string | null>(null)

  const submit = async () => {
    if (!form.validate()) return
    setFailure(null)
    try {
      await createProvider.mutateAsync({
        name: form.values.name.trim(),
        providerType: 'cloudflare',
        apiToken: form.values.apiToken,
        accountEmail: form.values.accountEmail || undefined,
        features: { dnsManagement: true, tunnelManagement: false },
      })
      toast.success('Cloudflare account connected', { description: 'Turn on Tunnel management in its settings to use it for the public edge.' })
      onOpenChange(false)
      form.reset()
    } catch (err) {
      setFailure(getErrorMessage(err, 'Cloudflare rejected this token.'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setFailure(null)
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect a Cloudflare account</DialogTitle>
          <DialogDescription>The token is checked against Cloudflare first. If it is invalid, nothing is saved and the reason is shown here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldHelp href="https://dash.cloudflare.com/profile/api-tokens" linkLabel="Create a token on Cloudflare">
            <p>Create a custom token with these permissions:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              <li>
                <span className="font-mono">Zone → Zone → Read</span> and <span className="font-mono">Zone → DNS → Edit</span>, for DNS records
              </li>
              <li>
                <span className="font-mono">Account → Cloudflare Tunnel → Edit</span>, only if this account will host the public edge tunnel
              </li>
            </ul>
          </FieldHelp>
          <TextField id="cf-name" label="Account name" value={form.values.name} onChange={(v) => { form.setValue('name', v); }} onBlur={() => { form.touch('name'); }} error={form.errorFor('name')} placeholder="Company Cloudflare" />
          <TextField id="cf-token" label="API token" secret help="Encrypted at rest; you will not be able to read it back." value={form.values.apiToken} onChange={(v) => { form.setValue('apiToken', v); }} onBlur={() => { form.touch('apiToken'); }} error={form.errorFor('apiToken')} />
          <TextField id="cf-email" label="Account email" optional type="email" value={form.values.accountEmail} onChange={(v) => { form.setValue('accountEmail', v); }} onBlur={() => { form.touch('accountEmail'); }} error={form.errorFor('accountEmail')} placeholder="you@example.com" />
          {failure ? (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {failure}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={createProvider.isPending}>
            {createProvider.isPending ? 'Verifying token…' : 'Verify and connect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
