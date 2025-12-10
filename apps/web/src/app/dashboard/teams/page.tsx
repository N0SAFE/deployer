'use client'

import type React from 'react'
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
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
  useTeams,
  useUserTeams,
  useCreateTeam,
  useDeleteTeam,
  useSetActiveTeam,
  useOrganizations,
} from '@/hooks'
import { SearchFilter, EmptyState } from '@/components/dashboard'
import { TeamCard } from '@/components/dashboard/teams'
import {
  Building2,
  Plus,
  RefreshCcw,
  Users,
  Star,
  Trash2,
} from 'lucide-react'

export default function TeamsPage() {
  const router = useRouter()

  const [searchQuery, setSearchQuery] = useState('')
  const [selectedOrgId, setSelectedOrgId] = useState<string>('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [teamToDelete, setTeamToDelete] = useState<{ id: string; name: string } | null>(null)
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamOrgId, setNewTeamOrgId] = useState('')

  // Queries
  const organizations = useOrganizations()
  const teams = useTeams(selectedOrgId || undefined)
  const userTeams = useUserTeams()

  // Mutations
  const createTeam = useCreateTeam()
  const deleteTeam = useDeleteTeam()
  const setActiveTeam = useSetActiveTeam()

  const orgList = organizations.data ?? []
  const teamList = teams.data ?? []
  const userTeamList = userTeams.data ?? []

  const isLoading = organizations.isLoading || teams.isLoading
  const isFetching = teams.isFetching

  // Filter teams
  const filteredTeams = useMemo(() => {
    if (!searchQuery) return teamList
    const searchLower = searchQuery.toLowerCase()
    return teamList.filter((t) => t.name.toLowerCase().includes(searchLower))
  }, [teamList, searchQuery])

  // Organization filter options
  const orgFilterOptions = useMemo(() => {
    return [
      { value: '', label: 'All Organizations' },
      ...orgList.map((org) => ({ value: org.id, label: org.name })),
    ]
  }, [orgList])

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return
    try {
      await createTeam.mutateAsync({
        name: newTeamName.trim(),
        organizationId: newTeamOrgId || undefined,
      })
      setCreateDialogOpen(false)
      setNewTeamName('')
      setNewTeamOrgId('')
    } catch (error) {
      console.error('Failed to create team:', error)
    }
  }

  const handleDeleteTeam = async () => {
    if (!teamToDelete) return
    try {
      await deleteTeam.mutateAsync({
        teamId: teamToDelete.id,
        organizationId: selectedOrgId || undefined,
      })
      setDeleteDialogOpen(false)
      setTeamToDelete(null)
    } catch (error) {
      console.error('Failed to delete team:', error)
    }
  }

  const handleSetActive = async (teamId: string) => {
    try {
      await setActiveTeam.mutateAsync({ teamId })
    } catch (error) {
      console.error('Failed to set active team:', error)
    }
  }

  const openDeleteDialog = (team: { id: string; name: string }) => {
    setTeamToDelete(team)
    setDeleteDialogOpen(true)
  }

  const handleRefresh = () => {
    void Promise.all([organizations.refetch(), teams.refetch(), userTeams.refetch()])
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-3xl font-bold">Teams</h1>
          <p className="text-muted-foreground">Manage teams across your organizations</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetching}>
            {isFetching && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
            Refresh
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Create Team
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Team</DialogTitle>
                <DialogDescription>
                  Create a new team within an organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="team-name">Team Name</Label>
                  <Input
                    id="team-name"
                    placeholder="Engineering"
                    value={newTeamName}
                    onChange={(e) => {setNewTeamName(e.target.value)}}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="team-org">Organization</Label>
                  <Select value={newTeamOrgId} onValueChange={setNewTeamOrgId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select organization" />
                    </SelectTrigger>
                    <SelectContent>
                      {orgList.map((org) => (
                        <SelectItem key={org.id} value={org.id}>
                          {org.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => {setCreateDialogOpen(false)}}>
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
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Teams</CardTitle>
            <Users className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{teamList.length}</div>
            <p className="text-muted-foreground text-sm">
              {selectedOrgId ? 'In selected organization' : 'Across all organizations'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">My Teams</CardTitle>
            <Star className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{userTeamList.length}</div>
            <p className="text-muted-foreground text-sm">Teams you&apos;re a member of</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Organizations</CardTitle>
            <Building2 className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{orgList.length}</div>
            <p className="text-muted-foreground text-sm">With your access</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Team Directory</CardTitle>
          <CardDescription>Browse and manage all teams</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="flex-1">
              <SearchFilter
                searchValue={searchQuery}
                onSearchChange={setSearchQuery}
                searchPlaceholder="Search teams..."
                filters={[
                  {
                    id: 'organization',
                    label: 'Organization',
                    type: 'select',
                    options: orgFilterOptions,
                  },
                ]}
                activeFilters={selectedOrgId ? [{ filterId: 'organization', value: selectedOrgId }] : []}
                onFilterChange={(filterId, value) => {
                  if (filterId === 'organization') {
                    setSelectedOrgId(value as string)
                  }
                }}
                onClearAll={() => {
                  setSearchQuery('')
                  setSelectedOrgId('')
                }}
              />
            </div>
          </div>

          {/* Teams Grid */}
          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-32 w-full" />
              ))}
            </div>
          ) : filteredTeams.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No teams found"
              description={
                searchQuery || selectedOrgId
                  ? 'Try adjusting your filters.'
                  : 'Create a team to organize members.'
              }
              actionElement={
                !searchQuery && !selectedOrgId && (
                  <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Team
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredTeams.map((team) => (
                <TeamCard
                  key={team.id}
                  team={team}
                  isActive={userTeamList.some((ut) => ut.id === team.id)}
                  onSelect={(t) => router.push(`/dashboard/teams/${t.id}`)}
                  onSettings={(t) => router.push(`/dashboard/teams/${t.id}/settings`)}
                  onDelete={(t) => openDeleteDialog({ id: t.id, name: t.name })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Team</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{teamToDelete?.name}&quot;? This action cannot be undone.
              All members will be removed from the team.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDeleteTeam()}
            >
              {deleteTeam.isPending && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Team
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
