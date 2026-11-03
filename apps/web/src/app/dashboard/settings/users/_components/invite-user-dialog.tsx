'use client'

import { Copy, Link2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@deployer/ui/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@deployer/ui/components/shadcn/dialog'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Label } from '@deployer/ui/components/shadcn/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deployer/ui/components/shadcn/select'

import type { RoleOption } from '@/domains/role/hooks'
import { isPlatformRole } from '@/lib/access/platform-role.rules'
import { authClient } from '@/lib/auth'

/**
 * Invite a person (`AUTH-010`).
 *
 * The account is provisioned at invite time with the chosen role, and the response carries the token. There is no mail
 * transport yet (`AUTH-015`), so the link is shown to COPY rather than pretending an email was sent — the inviter can
 * deliver it however they already talk to the person.
 */
export function InviteUserDialog({ roles, onClose }: { roles: RoleOption[]; onClose: () => void }) {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState(() => roles[0]?.name ?? 'user')
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const invite = async () => {
    if (!isPlatformRole(role)) {
      toast.error(`"${role}" is not a role this platform can assign.`)
      return
    }

    setBusy(true)
    try {
      const result = await authClient.invite.create({ email: email.trim(), role })
      if (result.error) {
        toast.error(result.error.message ?? 'The invitation could not be created')
        return
      }
      const token = (result.data as { token?: string } | null)?.token
      if (token === undefined) {
        toast.error('The invitation was created but carried no token')
        return
      }
      setLink(`${window.location.origin}/invite?token=${encodeURIComponent(token)}`)
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (link === null) return
    await navigator.clipboard.writeText(link)
    toast.success('Invitation link copied')
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a user</DialogTitle>
          <DialogDescription>
            The account is created now with the role you pick; the invitee sets their name and password from the link.
          </DialogDescription>
        </DialogHeader>

        {link === null ? (
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                autoComplete="off"
                onChange={(event) => { setEmail(event.target.value) }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={(value) => { setRole(value) }}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((option) => (
                    <SelectItem key={option.name} value={option.name}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                You can only invite a role weaker than your own; the server refuses the rest.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-sm">Send this link to {email.trim()}:</p>
            <div className="flex items-center gap-2">
              <Link2 className="text-muted-foreground size-4 shrink-0" />
              <code className="bg-muted max-h-24 flex-1 overflow-auto rounded p-2 text-xs break-all">{link}</code>
            </div>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              <Copy className="size-4" />
              Copy link
            </Button>
            <p className="text-muted-foreground text-xs">The link expires on its own; the invitation is single-use.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {link === null ? 'Cancel' : 'Done'}
          </Button>
          {link === null ? (
            <Button disabled={busy || email.trim() === ''} onClick={() => void invite()}>
              {busy ? 'Creating…' : 'Create invitation'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
