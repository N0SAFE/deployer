'use client'

import type React from 'react'
import { useState, useMemo } from 'react'
import Link from 'next/link'
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
import { Textarea } from '@repo/ui/components/shadcn/textarea'
import {
  useOrganizations,
  useCreateOrganization,
  useSetActiveOrganization,
} from '@/hooks'
import { SearchFilter, Pagination, EmptyState } from '@/components/dashboard'
import {
  Building2,
  Plus,
  RefreshCcw,
  Users,
  FolderKanban,
  Crown,
  CheckCircle2,
} from 'lucide-react'

export default function OrganizationsPage() {
  // Filter and pagination state
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(12)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [newOrgSlug, setNewOrgSlug] = useState('')

  const organizations = useOrganizations()
  const createOrg = useCreateOrganization()
  const setActiveOrg = useSetActiveOrganization()

  const orgList = organizations.data ?? []

  // Apply search filter
  const filteredList = useMemo(() => {
    if (!search) return orgList
    const searchLower = search.toLowerCase()
    return orgList.filter(
      (org) =>
        org.name.toLowerCase().includes(searchLower) ||
        org.slug.toLowerCase().includes(searchLower)
    )
  }, [orgList, search])

  // Paginate
  const totalFiltered = filteredList.length
  const paginatedList = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredList.slice(start, start + pageSize)
  }, [filteredList, page, pageSize])

  const isLoading = organizations.isLoading
  const isFetching = organizations.isFetching

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) return

    try {
      await createOrg.mutateAsync({
        name: newOrgName.trim(),
        slug: newOrgSlug.trim() || undefined,
      })
      setCreateDialogOpen(false)
      setNewOrgName('')
      setNewOrgSlug('')
    } catch (error) {
      console.error('Failed to create organization:', error)
    }
  }

  const handleSetActive = async (orgId: string) => {
    try {
      await setActiveOrg.mutateAsync({ organizationId: orgId })
    } catch (error) {
      console.error('Failed to set active organization:', error)
    }
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Organizations</h1>
          <p className="text-muted-foreground">
            Manage your organizations, teams, and project access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void organizations.refetch()}
            disabled={isFetching}
          >
            {isFetching && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
            Refresh
          </Button>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Create Organization
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Organization</DialogTitle>
                <DialogDescription>
                  Create a new organization to manage teams and projects.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Organization Name</Label>
                  <Input
                    id="org-name"
                    placeholder="Acme Inc."
                    value={newOrgName}
                    onChange={(e) => setNewOrgName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="org-slug">Slug (optional)</Label>
                  <Input
                    id="org-slug"
                    placeholder="acme-inc"
                    value={newOrgSlug}
                    onChange={(e) => setNewOrgSlug(e.target.value)}
                  />
                  <p className="text-muted-foreground text-xs">
                    URL-friendly identifier. Auto-generated if not provided.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleCreateOrg()}
                  disabled={createOrg.isPending || !newOrgName.trim()}
                >
                  {createOrg.isPending && (
                    <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create
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
            <CardTitle className="text-sm font-medium">Total Organizations</CardTitle>
            <Building2 className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : orgList.length}</div>
            <p className="text-muted-foreground text-sm">Organizations you belong to</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <Users className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading
                ? '—'
                : orgList.reduce((sum, org) => sum + (org.members?.length ?? 0), 0)}
            </div>
            <p className="text-muted-foreground text-sm">Across all organizations</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Owner Of</CardTitle>
            <Crown className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoading
                ? '—'
                : orgList.filter((org) =>
                    org.members?.some((m) => m.role === 'owner')
                  ).length}
            </div>
            <p className="text-muted-foreground text-sm">Organizations you own</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Grid */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div>
            <CardTitle>All Organizations</CardTitle>
            <CardDescription>Click on an organization to manage it</CardDescription>
          </div>
          {isFetching && <RefreshCcw className="text-muted-foreground h-4 w-4 animate-spin" />}
        </CardHeader>
        <CardContent className="space-y-4">
          <SearchFilter
            searchValue={search}
            onSearchChange={(value) => {
              setSearch(value)
              setPage(1)
            }}
            searchPlaceholder="Search organizations..."
            filters={[]}
            activeFilters={[]}
            onClearAll={() => setSearch('')}
          />

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-40 w-full" />
              ))}
            </div>
          ) : paginatedList.length === 0 ? (
            <EmptyState
              icon={Building2}
              title={filteredList.length === 0 && orgList.length > 0 ? 'No matching organizations' : 'No organizations yet'}
              description={
                filteredList.length === 0 && orgList.length > 0
                  ? 'Try adjusting your search.'
                  : 'Create your first organization to start managing teams and projects.'
              }
              actionElement={
                filteredList.length === 0 && orgList.length > 0 ? (
                  <Button size="sm" variant="outline" onClick={() => setSearch('')}>
                    Clear Search
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" />
                    Create Organization
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {paginatedList.map((org) => {
                const memberCount = org.members?.length ?? 0
                const isOwner = org.members?.some((m) => m.role === 'owner')

                return (
                  <Link key={org.id} href={`/dashboard/organizations/${org.id}`}>
                    <Card className="h-full cursor-pointer transition-colors hover:border-primary/50 hover:bg-muted/30">
                      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                        <div className="flex items-center gap-3">
                          <div className="bg-primary/10 flex h-10 w-10 items-center justify-center rounded-lg">
                            <Building2 className="text-primary h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="text-lg">{org.name}</CardTitle>
                            <CardDescription className="text-xs">
                              {org.slug}
                            </CardDescription>
                          </div>
                        </div>
                        {isOwner && (
                          <Badge variant="secondary" className="text-xs">
                            <Crown className="mr-1 h-3 w-3" />
                            Owner
                          </Badge>
                        )}
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground flex items-center gap-2">
                            <Users className="h-4 w-4" />
                            Members
                          </span>
                          <span className="font-medium">{memberCount}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground flex items-center gap-2">
                            <FolderKanban className="h-4 w-4" />
                            Projects
                          </span>
                          <span className="font-medium">—</span>
                        </div>
                        <div className="flex gap-2 pt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={(e) => {
                              e.preventDefault()
                              void handleSetActive(org.id)
                            }}
                          >
                            <CheckCircle2 className="mr-2 h-4 w-4" />
                            Set Active
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                )
              })}
            </div>
          )}

          {paginatedList.length > 0 && totalFiltered > pageSize && (
            <Pagination
              page={page}
              pageSize={pageSize}
              total={totalFiltered}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size)
                setPage(1)
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
