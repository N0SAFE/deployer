'use client'

import { useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@deployer/ui/components/shadcn/card'
import { PageSkeleton } from '@/components/dashboard'
import { getErrorMessage, isDefinedORPCError, UNKNOWN_ORPC_ERROR_MESSAGE } from '@/lib/orpc/typed-errors'
import {
  useInviteProjectCollaborator,
  useProjectCollaborators,
  useRemoveProjectCollaborator,
  useUpdateProjectCollaborator,
} from '@/domains/project/hooks'
import { ConfirmDialog } from '../../_components/ConfirmDialog'
import { InlineError } from '../../_components/workload/WorkloadStates'
import { InviteMemberDialog, type ProjectRole } from '../../_components/team/InviteMemberDialog'
import { InviteButton, MembersTable, type Member } from '../../_components/team/MembersTable'
import { countOwners, memberSummary } from '../_utils/team'

const errDescription = (err: unknown): string => (isDefinedORPCError(err) ? getErrorMessage(err) : UNKNOWN_ORPC_ERROR_MESSAGE)

export default function ProjectTeamPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const query = useProjectCollaborators(projectId)
  const invite = useInviteProjectCollaborator()
  const update = useUpdateProjectCollaborator()
  const remove = useRemoveProjectCollaborator()

  const [inviteOpen, setInviteOpen] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)

  const members = useMemo<readonly Member[]>(() => query.data?.collaborators ?? [], [query.data])
  const ownerCount = useMemo(() => countOwners(members), [members])

  if (query.isLoading) return <PageSkeleton blocks={1} withStrip={false} label="Loading team" />
  if (query.error) {
    return <InlineError title="Could not load the team" error={query.error} onRetry={() => { void query.refetch() }} />
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>Team</CardTitle>
            <CardDescription>{memberSummary(members)} — who can see and change this project, and with which role.</CardDescription>
          </div>
          <InviteButton onClick={() => { setInviteOpen(true) }} />
        </CardHeader>
        <CardContent>
          <MembersTable
            members={members}
            ownerCount={ownerCount}
            updatingUserId={update.isPending ? update.variables.params.userId : null}
            onChangeRole={(member, role) => {
              void update
                .mutateAsync({ params: { id: projectId, userId: member.userId }, body: { role } })
                .then(() => { toast.success('Role updated') })
                .catch((err: unknown) => { toast.error('Failed to update role', { description: errDescription(err) }) })
            }}
            onRemove={setRemoving}
            onInvite={() => { setInviteOpen(true) }}
          />
        </CardContent>
      </Card>

      {inviteOpen ? (
        <InviteMemberDialog
          pending={invite.isPending}
          onClose={() => { setInviteOpen(false) }}
          onInvite={async (email: string, role: ProjectRole) => {
            try {
              await invite.mutateAsync({ params: { id: projectId }, body: { email, role } })
              toast.success('Invitation sent')
              setInviteOpen(false)
            } catch (err) {
              toast.error('Failed to send invitation', { description: errDescription(err) })
            }
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          title="Remove member"
          objectName={removing.userId}
          consequence="loses access to this project immediately. They can be invited again later."
          confirmLabel="Remove member"
          pending={remove.isPending}
          onClose={() => { setRemoving(null) }}
          onConfirm={() => {
            void remove
              .mutateAsync({ params: { id: projectId, userId: removing.userId } })
              .then(() => { toast.success('Member removed'); setRemoving(null) })
              .catch((err: unknown) => { toast.error('Failed to remove member', { description: errDescription(err) }) })
          }}
        />
      ) : null}
    </>
  )
}
