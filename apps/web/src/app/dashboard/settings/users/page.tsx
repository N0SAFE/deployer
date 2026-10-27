'use client'

import { useMemo, useState } from 'react'
import type { PlatformRole } from '@deployer/auth'
import { useAdminListUsers, useAdminActions } from '@/domains/admin/hooks'
import { Button } from '@deployer/ui/components/shadcn/button'
import { Badge } from '@deployer/ui/components/shadcn/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@deployer/ui/components/shadcn/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@deployer/ui/components/shadcn/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@deployer/ui/components/shadcn/select'
import { Input } from '@deployer/ui/components/shadcn/input'
import { Skeleton } from '@deployer/ui/components/shadcn/skeleton'
import { Ban, ShieldCheck, UserX, RefreshCw } from 'lucide-react'
import { useSession } from '@/lib/auth'
import { PageHeader, PageErrorState } from '@/components/dashboard'
import { toast } from 'sonner'
import { BanUserDialog, RemoveUserDialog } from './_components/user-dialogs'

const ROLE_HELP: { label: string; text: string }[] = [
  { label: 'Super Admin', text: 'full access to everything, including system configuration.' },
  { label: 'Admin', text: 'manages users (create, ban, change roles) and sees platform data, but has no system configuration access.' },
  { label: 'Operator', text: 'runs and observes the platform (logs, analytics, domains, routing) without managing users.' },
  { label: 'Viewer', text: 'read-only visibility.' },
]

export default function SettingsUsersPage() {
  const { data: session } = useSession()
  const currentUserId = session?.user.id
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | PlatformRole>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'banned'>('all')
  const [selectedUser, setSelectedUser] = useState<{ id: string; name: string } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  
  const pageSize = 20
  
  const { data: usersData, isLoading, error: usersError, refetch } = useAdminListUsers({
    limit: pageSize,
    offset: page * pageSize,
  })
  
  const { 
    banUser, 
    unbanUser, 
    setRole, 
    removeUser,
    isLoading: actionLoading,
  } = useAdminActions()

  const handleRoleChange = (userId: string, role: PlatformRole) => {
    if (userId === currentUserId) {
      toast.error('You cannot change your own role. Ask another admin.')
      return
    }
    setRole({ userId, role })
  }

  const handleBanClick = (user: { id: string; name: string }) => {
    if (user.id === currentUserId) {
      toast.error('You cannot ban yourself.')
      return
    }
    setSelectedUser(user)
  }

  const handleUnban = (userId: string) => {
    unbanUser({ userId })
  }

  const handleRemove = (userId: string) => {
    if (userId === currentUserId) {
      toast.error('You cannot remove your own account here.')
      return
    }
    // Replaced a blocking `confirm()`: this file already uses <Dialog> for the
    // ban flow, so an irreversible delete of the same kind was the only place
    // still relying on the browser's unstyled prompt.
    setRemoveTarget(usersData?.users.find((u) => u.id === userId) ?? { id: userId, name: userId })
  }

  const confirmRemove = () => {
    if (!removeTarget) return
    removeUser({ userId: removeTarget.id })
    setRemoveTarget(null)
  }

  const users = useMemo(() => usersData?.users ?? [], [usersData])
  const hasNextPage = users.length === pageSize

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase()

    return users.filter((user) => {
      const matchesSearch =
        query.length === 0 ||
        `${user.name} ${user.email}`.toLowerCase().includes(query)

      const matchesRole = roleFilter === 'all' || user.role === roleFilter
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? !user.banned : user.banned)

      return matchesSearch && matchesRole && matchesStatus
    })
  }, [roleFilter, search, statusFilter, users])

  const surfaceCardClass =
    'border-border/60 bg-card/40 backdrop-blur-xl'

  if (usersError) {
    return <PageErrorState title="Could not load users" message={usersError.message} onRetry={() => { void refetch() }} />
  }

  if (isLoading && page === 0) {
    return (
      <div className="container mx-auto max-w-350 py-8 space-y-6">
        <div>
          <Skeleton className="h-9 w-64 mb-2" />
          <Skeleton className="h-5 w-96" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-350 py-8 space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Users & access"
        description="See who can sign in to this platform, what each person is allowed to do, and suspend or remove access when needed."
        badge={
          <>
            <Badge variant="secondary">{users.length} loaded</Badge>
            <Badge variant="outline">{filteredUsers.length} visible</Badge>
          </>
        }
        actions={
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              void refetch()
            }}
            disabled={isLoading}
            aria-label="Refresh users"
          >
            <RefreshCw className={`size-4 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
        }
      />

      <dl className="grid gap-x-6 gap-y-1 rounded-lg border border-border/60 px-4 py-3 text-sm text-muted-foreground sm:grid-cols-2">
        {ROLE_HELP.map((role) => (
          <div key={role.label}>
            <dt className="inline font-medium text-foreground">{role.label}: </dt>
            <dd className="inline">{role.text}</dd>
          </div>
        ))}
      </dl>

      <Card className={surfaceCardClass}>
        <CardHeader>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>People</CardTitle>
              <CardDescription>
                Everyone registered on the platform. Changes to roles and bans apply immediately.
              </CardDescription>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                placeholder="Search name or email..."
                aria-label="Search users by name or email"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value)
                }}
              />
              <Select value={roleFilter} onValueChange={(value) => {
                setRoleFilter(value as 'all' | PlatformRole)
              }}>
                <SelectTrigger aria-label="Filter by role">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="superAdmin">Super Admin</SelectItem>
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => {
                setStatusFilter(value as 'all' | 'active' | 'banned')
              }}>
                <SelectTrigger aria-label="Filter by status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    {users.length === 0 ? 'No users yet.' : 'No users match your filters.'}
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.name}
                      {user.id === currentUserId && <Badge variant="outline" className="ml-2">You</Badge>}
                    </TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Select
                        value={user.role ?? 'viewer'}
                        onValueChange={(role) => {
                          handleRoleChange(user.id, role as PlatformRole)
                        }}
                        disabled={actionLoading.setRole || user.id === currentUserId}
                      >
                        <SelectTrigger className="w-36">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="viewer">Viewer</SelectItem>
                          <SelectItem value="operator">Operator</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="superAdmin">Super Admin</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {user.banned ? (
                        <Badge variant="destructive" className="gap-1">
                          <Ban className="h-3 w-3" />
                          Banned
                        </Badge>
                      ) : (
                        <Badge variant="default" className="gap-1 bg-green-600">
                          <ShieldCheck className="h-3 w-3" />
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {user.banned ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              handleUnban(user.id)
                            }}
                            disabled={actionLoading.unban}
                          >
                            <ShieldCheck className="h-4 w-4 mr-1" />
                            Unban
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              handleBanClick({ id: user.id, name: user.name })
                            }}
                            disabled={actionLoading.ban || user.id === currentUserId}
                          >
                            <Ban className="h-4 w-4 mr-1" />
                            Ban
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => {
                            handleRemove(user.id)
                          }}
                          disabled={actionLoading.remove || user.id === currentUserId}
                        >
                          <UserX className="h-4 w-4 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          <div className="flex items-center justify-between mt-4 pt-4 border-t">
            <div className="text-sm text-muted-foreground">
              Showing {filteredUsers.length} of {users.length} loaded users (page {page + 1})
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPage(p => Math.max(0, p - 1))
                }}
                disabled={page === 0 || isLoading}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPage(p => p + 1)
                }}
                disabled={!hasNextPage || isLoading}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedUser ? (
        <BanUserDialog
          user={selectedUser}
          pending={actionLoading.ban}
          onClose={() => { setSelectedUser(null) }}
          onConfirm={({ reason, expiresInSeconds }) => {
            banUser({ userId: selectedUser.id, banReason: reason, banExpiresIn: expiresInSeconds })
            setSelectedUser(null)
          }}
        />
      ) : null}
      {removeTarget ? (
        <RemoveUserDialog user={removeTarget} pending={actionLoading.remove} onClose={() => { setRemoveTarget(null) }} onConfirm={confirmRemove} />
      ) : null}
    </div>
  )
}
