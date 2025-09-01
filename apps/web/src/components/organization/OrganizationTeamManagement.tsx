'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Badge } from '@repo/ui/components/shadcn/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@repo/ui/components/shadcn/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@repo/ui/components/shadcn/alert-dialog'
import {
  Users,
  UserPlus,
  MoreHorizontal,
  Mail,
  Crown,
  Shield,
  User,
  Trash2,
  Clock,
  XCircle,
  Loader2,
} from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from '@repo/ui/components/shadcn/avatar'
import {
  useActiveOrganization,
  useOrganizationMembers,
  useInviteMember,
  useUpdateMemberRole,
  useRemoveMember,
  useOrganizationInvitations,
  useCancelInvitation,
} from '@/hooks/useTeams'

interface OrganizationTeamManagementProps {
  className?: string
}

export default function OrganizationTeamManagement({ className }: OrganizationTeamManagementProps) {
  const { data: activeOrg } = useActiveOrganization()
  const { data: members = [], isLoading: membersLoading } = useOrganizationMembers(activeOrg?.id)
  const { data: invitations = [], isLoading: invitationsLoading } = useOrganizationInvitations(activeOrg?.id)
  
  const inviteMember = useInviteMember()
  const updateMemberRole = useUpdateMemberRole()
  const removeMember = useRemoveMember()
  const cancelInvitation = useCancelInvitation()
  
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null)

  const handleInviteMember = async () => {
    if (!inviteEmail || !activeOrg) return

    try {
      await inviteMember.mutateAsync({
        email: inviteEmail,
        role: inviteRole,
        organizationId: activeOrg.id,
      })
      setInviteDialogOpen(false)
      setInviteEmail('')
      setInviteRole('member')
    } catch {
      // Error handling is done in the hook
    }
  }

  const handleUpdateRole = async (memberId: string, newRole: 'member' | 'admin' | 'owner') => {
    if (!activeOrg) return

    try {
      await updateMemberRole.mutateAsync({
        memberId,
        role: newRole,
        organizationId: activeOrg.id,
      })
    } catch {
      // Error handling is done in the hook
    }
  }

  const handleRemoveMember = async (memberIdOrEmail: string) => {
    if (!activeOrg) return

    try {
      await removeMember.mutateAsync({
        memberIdOrEmail,
        organizationId: activeOrg.id,
      })
      setMemberToRemove(null)
    } catch {
      // Error handling is done in the hook
    }
  }

  const handleCancelInvitation = async (invitationId: string) => {
    try {
      await cancelInvitation.mutateAsync({ invitationId })
    } catch {
      // Error handling is done in the hook
    }
  }

  const getRoleIcon = (role: string | string[]) => {
    const roles = Array.isArray(role) ? role : [role]
    if (roles.includes('owner')) return <Crown className="h-3.5 w-3.5 text-yellow-600" />
    if (roles.includes('admin')) return <Shield className="h-3.5 w-3.5 text-blue-600" />
    return <User className="h-3.5 w-3.5 text-gray-600" />
  }

  const getRoleBadge = (role: string | string[]) => {
    const roles = Array.isArray(role) ? role : [role]
    if (roles.includes('owner')) return <Badge variant="default" className="text-xs">Owner</Badge>
    if (roles.includes('admin')) return <Badge variant="secondary" className="text-xs">Admin</Badge>
    return <Badge variant="outline" className="text-xs">Member</Badge>
  }

  if (!activeOrg) {
    return (
      <div className="text-center py-12">
        <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
        <h3 className="text-lg font-medium mb-2">No Organization Selected</h3>
        <p className="text-muted-foreground">
          Select an organization to manage team members
        </p>
      </div>
    )
  }

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Team Management</h2>
          <p className="text-muted-foreground">
            Manage members and permissions for {activeOrg.name}
          </p>
        </div>
        <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Invite Team Member</DialogTitle>
              <DialogDescription>
                Invite a new member to join {activeOrg.name}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="member@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="role">Role</Label>
                <Select value={inviteRole} onValueChange={(value: 'member' | 'admin') => setInviteRole(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">Member</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setInviteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleInviteMember}
                disabled={!inviteEmail || inviteMember.isPending}
              >
                {inviteMember.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Send Invitation
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Team Members */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Team Members ({members.length})
          </CardTitle>
          <CardDescription>
            Current members of your organization
          </CardDescription>
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading members...</span>
            </div>
          ) : members.length > 0 ? (
            <div className="space-y-4">
              {members.map((member: {
                id: string;
                role: string | string[];
                user: { name: string | null; email: string; image?: string | null };
              }) => (
                <div key={member.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={member.user.image ?? undefined} />
                      <AvatarFallback>
                        {member.user.name?.substring(0, 2).toUpperCase() || 
                         member.user.email.substring(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{member.user.name || member.user.email}</span>
                        {getRoleIcon(member.role)}
                      </div>
                      <p className="text-sm text-muted-foreground">{member.user.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getRoleBadge(member.role)}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {!member.role.includes('owner') && (
                          <>
                            <DropdownMenuItem
                              onClick={() => handleUpdateRole(member.id, 'member')}
                              disabled={updateMemberRole.isPending}
                            >
                              <User className="h-4 w-4 mr-2" />
                              Make Member
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => handleUpdateRole(member.id, 'admin')}
                              disabled={updateMemberRole.isPending}
                            >
                              <Shield className="h-4 w-4 mr-2" />
                              Make Admin
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => setMemberToRemove(member.id)}
                              className="text-destructive"
                              disabled={removeMember.isPending}
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Remove Member
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No members yet</h3>
              <p className="text-muted-foreground mb-6">
                Invite team members to collaborate on projects
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending Invitations */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Pending Invitations ({invitations.length})
          </CardTitle>
          <CardDescription>
            Invitations that haven&apos;t been accepted yet
          </CardDescription>
        </CardHeader>
        <CardContent>
          {invitationsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin mr-2" />
              <span>Loading invitations...</span>
            </div>
          ) : invitations.length > 0 ? (
            <div className="space-y-4">
              {invitations.map((invitation: { id: string; email: string; role: string | string[]; expiresAt: string | number | Date }) => (
                <div key={invitation.id} className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center justify-center h-8 w-8 bg-muted rounded-full">
                      <Mail className="h-4 w-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{invitation.email}</span>
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Expires {new Date(invitation.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getRoleBadge(invitation.role)}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCancelInvitation(invitation.id)}
                      disabled={cancelInvitation.isPending}
                    >
                      {cancelInvitation.isPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      Cancel
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Mail className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No pending invitations</h3>
              <p className="text-muted-foreground">
                All invitations have been accepted or expired
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Remove Member Confirmation Dialog */}
      <AlertDialog open={!!memberToRemove} onOpenChange={() => setMemberToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Team Member</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this member from the organization? 
              This action cannot be undone and they will lose access to all projects.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => memberToRemove && handleRemoveMember(memberToRemove)}
              className="bg-destructive text-destructive-foreground"
              disabled={removeMember.isPending}
            >
              {removeMember.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Remove Member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}