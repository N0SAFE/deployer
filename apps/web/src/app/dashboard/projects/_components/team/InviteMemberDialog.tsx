'use client'

import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import z from 'zod/v4'

import { projectAssignableRoleSchema } from '@deployer/contracts-entities'
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@deployer/ui/components/shadcn/select'

import { ROLE_DESCRIPTIONS } from '../../[projectId]/_utils/team'

/** What a member may be invited AS — `owner` is transferred, not invited. */
export type ProjectRole = z.infer<typeof projectAssignableRoleSchema>

const inviteSchema = z.object({
    email: z.string().trim().pipe(z.email('Enter a valid email address')),
    role: projectAssignableRoleSchema,
})

/** Mount only while open so the form always starts empty. */
export function InviteMemberDialog({
    pending,
    onInvite,
    onClose,
}: {
    pending: boolean
    onInvite: (email: string, role: ProjectRole) => Promise<void>
    onClose: () => void
}) {
    const form = useForm({
        defaultValues: { email: '', role: 'viewer' as ProjectRole },
        onSubmit: async ({ value }) => {
            const parsed = inviteSchema.safeParse(value)
            if (!parsed.success) {
                toast.error(parsed.error.issues[0]?.message ?? 'Invalid input')
                return
            }
            await onInvite(parsed.data.email, parsed.data.role)
        },
    })
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) onClose()
            }}
        >
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Invite a member</DialogTitle>
                    <DialogDescription>
                        Send an invitation to join this project with the role
                        you choose.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <form.Field name="email">
                        {(field) => (
                            <div className="grid gap-2">
                                <Label htmlFor="invite-email">Email</Label>
                                <Input
                                    id="invite-email"
                                    type="email"
                                    placeholder="colleague@example.com"
                                    value={field.state.value}
                                    onChange={(e) => {
                                        field.handleChange(e.target.value)
                                    }}
                                />
                            </div>
                        )}
                    </form.Field>
                    <form.Field name="role">
                        {(field) => (
                            <div className="grid gap-2">
                                <Label htmlFor="invite-role">Role</Label>
                                <Select
                                    value={field.state.value}
                                    onValueChange={(v) => {
                                        field.handleChange(
                                            projectAssignableRoleSchema.parse(v)
                                        )
                                    }}
                                >
                                    <SelectTrigger id="invite-role">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {projectAssignableRoleSchema.options.map(
                                            (r) => (
                                                <SelectItem key={r} value={r}>
                                                    {r}
                                                </SelectItem>
                                            )
                                        )}
                                    </SelectContent>
                                </Select>
                                <p className="text-muted-foreground text-sm">
                                    {ROLE_DESCRIPTIONS[field.state.value]}
                                </p>
                            </div>
                        )}
                    </form.Field>
                </div>
                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={onClose}
                        disabled={pending}
                    >
                        Cancel
                    </Button>
                    <form.Subscribe selector={(s) => s.isSubmitting}>
                        {(isSubmitting) => (
                            <Button
                                onClick={() => {
                                    void form.handleSubmit()
                                }}
                                disabled={isSubmitting || pending}
                            >
                                {pending ? 'Sending…' : 'Send invitation'}
                            </Button>
                        )}
                    </form.Subscribe>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
