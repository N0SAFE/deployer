'use client'

import { useTeamStore, useTeamMembers } from '@/state/teamStore'
import TeamManagement from './TeamManagement'

interface TeamManagementContainerProps {
  projectId: string
}

export default function TeamManagementContainer({ projectId }: TeamManagementContainerProps) {
  const members = useTeamMembers(projectId)
  const currentUserId = useTeamStore(state => state.currentUserId)
  
  const inviteMember = useTeamStore(state => state.inviteMember)
  const updateRole = useTeamStore(state => state.updateRole)
  const removeMemberAsync = useTeamStore(state => state.removeMemberAsync)

  const handleInviteMember = async (email: string, role: string) => {
    await inviteMember(projectId, email, role)
  }

  const handleUpdateRole = async (memberId: string, role: string) => {
    await updateRole(projectId, memberId, role)
  }

  const handleRemoveMember = async (memberId: string) => {
    await removeMemberAsync(projectId, memberId)
  }

  return (
    <TeamManagement
      projectId={projectId}
      members={members}
      currentUserId={currentUserId || ''}
      onInviteMember={handleInviteMember}
      onUpdateRole={handleUpdateRole}
      onRemoveMember={handleRemoveMember}
    />
  )
}