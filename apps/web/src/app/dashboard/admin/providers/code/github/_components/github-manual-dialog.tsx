'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod/v4'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { useCreateGitHubApp } from '@/domains/github-apps/hooks'
import { getErrorMessage, isDomainError } from '@/lib/orpc/typed-errors'
import { FieldHelp } from '../../../_components/field-help'
import { TextField } from '../../../_components/text-field'
import { useSimpleForm } from '../../../_lib/use-simple-form'

const schema = z.object({
  name: z.string().trim().min(1, 'Give this app a name'),
  appId: z.string().trim().min(1, 'Enter the numeric App ID'),
  clientId: z.string().trim().min(1, 'Enter the Client ID'),
  clientSecret: z.string().min(1, 'Generate and paste a client secret'),
  privateKey: z.string().refine((v) => v.includes('BEGIN') && v.includes('PRIVATE KEY'), 'Paste the full PEM, including the BEGIN and END lines'),
  webhookSecret: z.string().min(1, 'Enter the webhook secret you set on the app'),
})

/** For an existing GitHub App: every credential, each with where to find it. */
export function GithubManualDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createApp = useCreateGitHubApp()
  const form = useSimpleForm(schema, { name: '', appId: '', clientId: '', clientSecret: '', privateKey: '', webhookSecret: '' })
  const [failure, setFailure] = useState<string | null>(null)

  const submit = async () => {
    if (!form.validate()) return
    setFailure(null)
    try {
      const v = form.values
      await createApp.mutateAsync({ name: v.name.trim(), appId: v.appId.trim(), clientId: v.clientId.trim(), clientSecret: v.clientSecret, privateKey: v.privateKey, webhookSecret: v.webhookSecret })
      toast.success('GitHub App added')
      onOpenChange(false)
      form.reset()
    } catch (err) {
      setFailure(isDomainError(err, 'CONFLICT') ? 'A GitHub App with this name already exists. Choose another name.' : getErrorMessage(err, 'The app could not be added.'))
    }
  }

  const f = (key: keyof typeof form.values) => ({ value: form.values[key], onChange: (v: string) => { form.setValue(key, v); }, onBlur: () => { form.touch(key); }, error: form.errorFor(key) })

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setFailure(null) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add an existing GitHub App</DialogTitle>
          <DialogDescription>Use this if you already created the app on GitHub. Otherwise prefer “Create GitHub App”, which fills all of this in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldHelp href="https://github.com/settings/apps" linkLabel="Open your GitHub Apps">
            <p>Open the app → <em>General</em>: App ID and Client ID are at the top; generate a client secret and a private key (.pem) further down.</p>
          </FieldHelp>
          <TextField id="gh-name" label="App name" {...f('name')} placeholder="Company deployer" />
          <TextField id="gh-appid" label="App ID" mono {...f('appId')} placeholder="123456" />
          <TextField id="gh-clientid" label="Client ID" mono {...f('clientId')} placeholder="Iv1.0123456789abcdef" />
          <TextField id="gh-secret" label="Client secret" secret help="Encrypted at rest." {...f('clientSecret')} />
          <TextField id="gh-key" label="Private key (PEM)" multiline mono help="Paste the whole file contents." {...f('privateKey')} placeholder="-----BEGIN RSA PRIVATE KEY-----" />
          <TextField id="gh-webhook" label="Webhook secret" secret help="The secret set under “Webhook” on the app; GitHub signs deliveries with it." {...f('webhookSecret')} />
          {failure ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{failure}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={createApp.isPending}>{createApp.isPending ? 'Adding…' : 'Add GitHub App'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
