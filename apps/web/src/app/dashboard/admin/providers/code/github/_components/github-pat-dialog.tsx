'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { z } from 'zod/v4'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { useGitHubCreateFromPat } from '@/domains/github-apps/hooks'
import { getErrorMessage } from '@/lib/orpc/typed-errors'
import { FieldHelp } from '../../../_components/field-help'
import { TextField } from '../../../_components/text-field'
import { useSimpleForm } from '../../../_lib/use-simple-form'

const schema = z.object({
  name: z.string().trim().min(1, 'Give this connection a name'),
  pat: z.string().min(1, 'Paste a personal access token'),
})

export function GithubPatDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const createFromPat = useGitHubCreateFromPat()
  const form = useSimpleForm(schema, { name: '', pat: '' })
  const [failure, setFailure] = useState<string | null>(null)

  const submit = async () => {
    if (!form.validate()) return
    setFailure(null)
    try {
      await createFromPat.mutateAsync({ name: form.values.name.trim(), pat: form.values.pat })
      toast.success('GitHub connected with a personal access token')
      onOpenChange(false)
      form.reset()
    } catch (err) {
      setFailure(getErrorMessage(err, 'GitHub rejected this token.'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setFailure(null) }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Connect with a personal access token</DialogTitle>
          <DialogDescription>The token is validated with GitHub first. Nothing is saved if GitHub refuses it.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <FieldHelp href="https://github.com/settings/tokens" linkLabel="Create a token on GitHub">
            <p>
              Give it the <code className="font-mono">repo</code> scope for private repositories (<code className="font-mono">public_repo</code> is enough for public
              ones). A token has no webhooks, so pushes will not trigger deploys on their own.
            </p>
          </FieldHelp>
          <TextField id="pat-name" label="Connection name" value={form.values.name} onChange={(v) => { form.setValue('name', v); }} onBlur={() => { form.touch('name'); }} error={form.errorFor('name')} placeholder="Personal GitHub" />
          <TextField id="pat-token" label="Personal access token" secret help="Starts with ghp_ or github_pat_. Encrypted at rest." value={form.values.pat} onChange={(v) => { form.setValue('pat', v); }} onBlur={() => { form.touch('pat'); }} error={form.errorFor('pat')} />
          {failure ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{failure}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { onOpenChange(false); }}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={createFromPat.isPending}>{createFromPat.isPending ? 'Validating with GitHub…' : 'Validate and connect'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
