'use client'

import type React from 'react'
import { useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Separator } from '@repo/ui/components/shadcn/separator'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@repo/ui/components/shadcn/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@repo/ui/components/shadcn/dialog'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@repo/ui/components/shadcn/select'
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@repo/ui/components/shadcn/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  useOrganization,
  useOrganizationMembers,
  useTeams,
  useInviteMember,
  useRemoveMember,
  useUpdateMemberRole,
  useCreateTeam,
  useDeleteOrganization,
} from '@/hooks'
import { SearchFilter, EmptyState } from '@/components/dashboard'
import { TeamCard } from '@/components/dashboard/teams'
import {
  ArrowLeft,
  Building2,
  Crown,
  Mail,
  MoreVertical,
  Plus,
  RefreshCcw,
  Settings,
  Shield,
  Trash2,
  User,
  UserCog,
  UserMinus,
  Users,
} from 'lucide-react'

const roleConfig: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  owner: { label: 'Owner', color: 'bg-amber-100 text-amber-800', icon: Crown },
  admin: { label: 'Admin', color: 'bg-blue-100 text-blue-800', icon: Shield },
  member: { label: 'Member', color: 'bg-green-100 text-green-800', icon: User },
  viewer: { label: 'Viewer', color: 'bg-gray-100 text-gray-800', icon: User },
}

export default function OrganizationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const orgId = params.id as string

  const [memberSearch, setMemberSearch] = useState('')
  const [teamSearch, setTeamSearch] = useState('')
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false)
  const [createTeamDialogOpen, setCreateTeamDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member')
  const [newTeamName, setNewTeamName] = useState('')

  const organization = useOrganization(orgId)
  const members = useOrganizationMembers(orgId)
  const teams = useTeams(orgId)
  const inviteMember = useInviteMember()
  const removeMember = useRemoveMember()
  const updateRole = useUpdateMemberRole()
  const createTeam = useCreateTeam()
  const deleteOrg = useDeleteOrganization()

  const org = organization.data
  const memberList = members.data ?? []
  const teamList = teams.data ?? []

  const isLoading = organization.isLoading || members.isLoading
  const isFetching = organization.isFetching || members.isFetching

  // Filter members
  const filteredMembers = useMemo(() => {
    if (!memberSearch) return memberList
    const searchLower = memberSearch.toLowerCase()
    return memberList.filter(
      (m) =>
        m.user.name?.toLowerCase().includes(searchLower) ||
        m.user.email.toLowerCase().includes(searchLower)
    )
  }, [memberList, memberSearch])

  // Filter teams
  const filteredTeams = useMemo(() => {
    if (!teamSearch) return teamList
    const searchLower = teamSearch.toLowerCase()
    return teamList.filter((t) => t.name.toLowerCase().includes(searchLower))
  }, [teamList, teamSearch])

  const handleInvite = async () => {
    if (!inviteEmail.trim()) return
    try {
      await inviteMember.mutateAsync({
        organizationId: orgId,
        email: inviteEmail.trim(),
        role: inviteRole,
      })
      setInviteDialogOpen(false)
      setInviteEmail('')
      setInviteRole('member')
    } catch (error) {
      console.error('Failed to invite member:', error)
    }
  }

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeMember.mutateAsync({
        organizationId: orgId,
        memberIdOrEmail: memberId,
      })
    } catch (error) {
      console.error('Failed to remove member:', error)
    }
  }

  const handleUpdateRole = async (memberId: string, role: 'admin' | 'member') => {
    try {
      await updateRole.mutateAsync({
        organizationId: orgId,
        memberIdOrEmail: memberId,
        role,
      })
    } catch (error) {
      console.error('Failed to update role:', error)
    }
  }

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return
    try {
      await createTeam.mutateAsync({
        organizationId: orgId,
        name: newTeamName.trim(),
      })
      setCreateTeamDialogOpen(false)
      setNewTeamName('')
    } catch (error) {
      console.error('Failed to create team:', error)
    }
  }

  const handleDeleteOrg = async () => {
    try {
      await deleteOrg.mutateAsync({ organizationId: orgId })
      router.push('/dashboard/organizations')
    } catch (error) {
      console.error('Failed to delete organization:', error)
    }
  }

  if (isLoading) {
    return (
      <div className="container mx-auto space-y-8 px-4 py-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }

  if (!org) {
    return (
      <div className="container mx-auto px-4 py-8">
        <EmptyState
          icon={Building2}
          title="Organization not found"
          description="The organization you're looking for doesn't exist or you don't have access."
          actionElement={
            <Button onClick={() => router.push('/dashboard/organizations')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Organizations
            </Button>
          }
        />
      </div>
    )
  }

  const isOwner = memberList.some((m) => m.role === 'owner' && m.userId === org.id)

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/dashboard/organizations')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-lg">
            <Building2 className="text-primary h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">{org.name}</h1>
            <p className="text-muted-foreground">{org.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void Promise.all([organization.refetch(), members.refetch(), teams.refetch()])}
            disabled={isFetching}
          >
            {isFetching && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem>
                <UserCog className="mr-2 h-4 w-4" />
                Edit Organization
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Organization
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Members</CardTitle>
            <Users className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{memberList.length}</div>
            <p className="text-muted-foreground text-sm">Active members</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Teams</CardTitle>
            <Users className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamList.length}</div>
            <p className="text-muted-foreground text-sm">Active teams</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Created</CardTitle>
            <Building2 className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {org.createdAt ? new Date(org.createdAt).toLocaleDateString() : '—'}
            </div>
            <p className="text-muted-foreground text-sm">Organization created</p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="members" className="space-y-4">
        <TabsList>
          <TabsTrigger value="members">
            <Users className="mr-2 h-4 w-4" />
            Members ({memberList.length})
          </TabsTrigger>
          <TabsTrigger value="teams">
            <Users className="mr-2 h-4 w-4" />
            Teams ({teamList.length})
          </TabsTrigger>
        </TabsList>

        {/* Members Tab */}
        <TabsContent value="members" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Organization Members</CardTitle>
                <CardDescription>Manage who has access to this organization</CardDescription>
              </div>
              <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Invite Member
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Invite Member</DialogTitle>
                    <DialogDescription>
                      Send an invitation to join this organization.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="invite-email">Email Address</Label>
                      <Input
                        id="invite-email"
                        type="email"
                        placeholder="colleague@example.com"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="invite-role">Role</Label>
                      <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as 'admin' | 'member')}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="member">Member</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => void handleInvite()}
                      disabled={inviteMember.isPending || !inviteEmail.trim()}
                    >
                      {inviteMember.isPending && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
                      <Mail className="mr-2 h-4 w-4" />
                      Send Invite
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4">
              <SearchFilter
                searchValue={memberSearch}
                onSearchChange={setMemberSearch}
                searchPlaceholder="Search members..."
                filters={[]}
                activeFilters={[]}
                onClearAll={() => setMemberSearch('')}
              />

              {filteredMembers.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No members found"
                  description={memberSearch ? 'Try adjusting your search.' : 'Invite members to get started.'}
                />
              ) : (
                <div className="space-y-2">
                  {filteredMembers.map((member) => {
                    const role = roleConfig[member.role] ?? roleConfig.member
                    const RoleIcon = role.icon

                    return (
                      <div
                        key={member.id}
                        className="flex items-center justify-between rounded-lg border p-4"
                      >
                        <div className="flex items-center gap-3">
                          <Avatar>
                            <AvatarImage src={member.user.image ?? undefined} />
                            <AvatarFallback>
                              {member.user.name?.charAt(0).toUpperCase() ??
                                member.user.email.charAt(0).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{member.user.name ?? member.user.email}</p>
                            <p className="text-muted-foreground text-sm">{member.user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={role.color}>
                            <RoleIcon className="mr-1 h-3 w-3" />
                            {role.label}
                          </Badge>
                          {member.role !== 'owner' && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {member.role !== 'admin' && (
                                  <DropdownMenuItem onClick={() => void handleUpdateRole(member.id, 'admin')}>
                                    <Shield className="mr-2 h-4 w-4" />
                                    Make Admin
                                  </DropdownMenuItem>
                                )}
                                {member.role !== 'member' && (
                                  <DropdownMenuItem onClick={() => void handleUpdateRole(member.id, 'member')}>
                                    <User className="mr-2 h-4 w-4" />
                                    Make Member
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => void handleRemoveMember(member.id)}
                                >
                                  <UserMinus className="mr-2 h-4 w-4" />
                                  Remove Member
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Teams Tab */}
        <TabsContent value="teams" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div>
                <CardTitle>Teams</CardTitle>
                <CardDescription>Organize members into teams for better collaboration</CardDescription>
              </div>
              <Dialog open={createTeamDialogOpen} onOpenChange={setCreateTeamDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Create Team
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create Team</DialogTitle>
                    <DialogDescription>
                      Create a new team within this organization.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="team-name">Team Name</Label>
                      <Input
                        id="team-name"
                        placeholder="Engineering"
                        value={newTeamName}
                        onChange={(e) => setNewTeamName(e.target.value)}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setCreateTeamDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={() => void handleCreateTeam()}
                      disabled={createTeam.isPending || !newTeamName.trim()}
                    >
                      {createTeam.isPending && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
                      Create Team
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent className="space-y-4">
              <SearchFilter
                searchValue={teamSearch}
                onSearchChange={setTeamSearch}
                searchPlaceholder="Search teams..."
                filters={[]}
                activeFilters={[]}
                onClearAll={() => setTeamSearch('')}
              />

              {teams.isLoading ? (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <Skeleton key={idx} className="h-32 w-full" />
                  ))}
                </div>
              ) : filteredTeams.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="No teams found"
                  description={teamSearch ? 'Try adjusting your search.' : 'Create a team to organize members.'}
                  actionElement={
                    !teamSearch && (
                      <Button size="sm" onClick={() => setCreateTeamDialogOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" />
                        Create Team
                      </Button>
                    )
                  }
                />
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {filteredTeams.map((team) => (
                    <TeamCard key={team.id} team={team} />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Organization</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{org.name}&quot;? This action cannot be undone.
              All teams, members, and projects within this organization will be removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteOrg()}
            >
              {deleteOrg.isPending && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              Delete Organization
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
