'use client'

import type React from 'react'
import Link from 'next/link'
import { useState, useMemo } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@repo/ui/components/shadcn/card'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Skeleton } from '@repo/ui/components/shadcn/skeleton'
import { Separator } from '@repo/ui/components/shadcn/separator'
import { useProjects } from '@/hooks/useProjects'
import { formatRelativeTime } from '@/lib/format'
import { DeploymentStatusBadge, EmptyState, CreateProjectDialog, SearchFilter, Pagination } from '@/components/dashboard'
import {
  Cloud,
  Rocket,
  Server,
  Users,
  RefreshCcw,
  ExternalLink,
  Clock3,
  Plus,
  FolderOpen,
} from 'lucide-react'

// Filter options for latest deployment status
const statusOptions = [
  { value: 'all', label: 'All Statuses' },
  { value: 'success', label: 'Success' },
  { value: 'failed', label: 'Failed' },
  { value: 'building', label: 'Building' },
  { value: 'deploying', label: 'Deploying' },
  { value: 'pending', label: 'Pending' },
]

export default function ProjectsPage() {
  // Filter and pagination state
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  const projects = useProjects({ limit: 100 }) // Fetch more for client-side filtering

  const allProjects = projects.data?.projects ?? []
  
  // Apply filters
  const filteredList = useMemo(() => {
    return allProjects.filter((p) => {
      // Search filter
      if (search) {
        const searchLower = search.toLowerCase()
        const matchesSearch = 
          p.name.toLowerCase().includes(searchLower) ||
          Boolean(p.description?.toLowerCase().includes(searchLower)) ||
          p.baseDomain?.toLowerCase().includes(searchLower)
        if (!matchesSearch) return false
      }
      // Status filter (based on latest deployment)
      if (statusFilter !== 'all') {
        const latestStatus = p.latestDeployment?.status
        if (latestStatus !== statusFilter) return false
      }
      return true
    })
  }, [allProjects, search, statusFilter])

  // Paginate
  const totalFiltered = filteredList.length
  const paginatedList = useMemo(() => {
    const start = (page - 1) * pageSize
    return filteredList.slice(start, start + pageSize)
  }, [filteredList, page, pageSize])

  const totalProjects = projects.data?.total ?? allProjects.length
  const totalServices = allProjects.reduce((sum, project) => sum + project._count.services, 0)
  const totalDeployments = allProjects.reduce((sum, project) => sum + project._count.deployments, 0)
  const totalCollaborators = allProjects.reduce((sum, project) => sum + (project._count.collaborators), 0)

  const isLoading = projects.isLoading
  const isFetching = projects.isFetching

  // Build active filters array for display
  const activeFilters: { key: string; label: string; value: string; onRemove: () => void }[] = []
  if (statusFilter !== 'all') {
    const opt = statusOptions.find((o) => o.value === statusFilter)
    activeFilters.push({
      key: 'status',
      label: 'Status',
      value: opt?.label ?? statusFilter,
      onRemove: () => {setStatusFilter('all')},
    })
  }

  const clearAllFilters = () => {
    setSearch('')
    setStatusFilter('all')
    setPage(1)
  }

  return (
    <div className="container mx-auto space-y-8 px-4 py-8">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold">Projects</h1>
          <p className="text-muted-foreground">
            Overview of tracked projects, their services, and latest deployments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void projects.refetch()}
            disabled={isFetching}
          >
            {isFetching && <RefreshCcw className="mr-2 h-4 w-4 animate-spin" />}
            Refresh
          </Button>
          <CreateProjectDialog
            trigger={
              <Button size="sm">
                <Plus className="mr-2 h-4 w-4" />
                Create Project
              </Button>
            }
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Projects</CardTitle>
            <Cloud className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : totalProjects}</div>
            <p className="text-muted-foreground text-sm">Total tracked projects</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Services</CardTitle>
            <Server className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : totalServices}</div>
            <p className="text-muted-foreground text-sm">Across all projects</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deployments</CardTitle>
            <Rocket className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : totalDeployments}</div>
            <p className="text-muted-foreground text-sm">Cumulative deployments</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Collaborators</CardTitle>
            <Users className="text-muted-foreground h-5 w-5" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{isLoading ? '—' : totalCollaborators}</div>
            <p className="text-muted-foreground text-sm">Across all projects</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <div>
            <CardTitle>Project list</CardTitle>
            <CardDescription>Detailed view of project activity</CardDescription>
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
            searchPlaceholder="Search by name, description, or domain..."
            filters={[
              {
                key: 'status',
                label: 'Deployment Status',
                value: statusFilter,
                options: statusOptions,
                onChange: (value) => {
                  setStatusFilter(value)
                  setPage(1)
                },
              },
            ]}
            activeFilters={activeFilters}
            onClearAll={clearAllFilters}
          />

          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton key={idx} className="h-14 w-full" />
              ))}
            </div>
          ) : paginatedList.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title={totalFiltered === 0 && allProjects.length > 0 ? "No matching projects" : "No projects yet"}
              description={totalFiltered === 0 && allProjects.length > 0 
                ? "Try adjusting your search or filter criteria." 
                : "Create your first project to start tracking deployments."}
              actionElement={
                totalFiltered === 0 && allProjects.length > 0 ? (
                  <Button size="sm" variant="outline" onClick={clearAllFilters}>
                    Clear Filters
                  </Button>
                ) : (
                  <CreateProjectDialog
                    trigger={
                      <Button size="sm">
                        <Plus className="mr-2 h-4 w-4" />
                        Create Project
                      </Button>
                    }
                  />
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Latest deployment</TableHead>
                    <TableHead>Services</TableHead>
                    <TableHead>Deployments</TableHead>
                    <TableHead>Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedList.map((project) => (
                    <TableRow
                      key={project.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        window.location.href = `/dashboard/projects/${project.id}`
                      }}
                    >
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/projects/${project.id}`}
                          className="flex flex-col hover:text-primary"
                          onClick={(e) => {e.stopPropagation()}}
                        >
                          <span>{project.name}</span>
                          <span className="text-muted-foreground text-xs">
                            {project.description}
                          </span>
                        </Link>
                      </TableCell>
                      <TableCell>
                        {project.baseDomain ? (
                          <Link
                            href={`https://${project.baseDomain}`}
                            target="_blank"
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            onClick={(e) => {e.stopPropagation()}}
                          >
                            <span>{project.baseDomain}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <DeploymentStatusBadge
                            status={project.latestDeployment?.status ?? 'unknown'}
                          />
                          <span className="text-muted-foreground text-xs">
                            {project.latestDeployment?.createdAt
                              ? formatRelativeTime(project.latestDeployment.createdAt)
                              : 'n/a'}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{project._count.services}</TableCell>
                      <TableCell>{project._count.deployments}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <Clock3 className="text-muted-foreground h-4 w-4" />
                          <span>{formatRelativeTime(project.updatedAt)}</span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {paginatedList.length > 0 && (
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

      <Separator />

      <div className="grid gap-4 md:grid-cols-2">
        {allProjects.slice(0, 4).map((project) => (
          <Link key={project.id} href={`/dashboard/projects/${project.id}`}>
            <Card className="h-full transition-colors hover:border-primary/50 hover:bg-muted/30">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base">{project.name}</CardTitle>
                  <DeploymentStatusBadge
                    status={project.latestDeployment?.status ?? 'unknown'}
                  />
                </div>
                <CardDescription className="line-clamp-2">
                  {project.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Services</span>
                  <span className="font-medium">{project._count.services}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Deployments</span>
                  <span className="font-medium">{project._count.deployments}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Collaborators</span>
                  <span className="font-medium">
                    {project._count.collaborators}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="font-medium">
                    {formatRelativeTime(project.updatedAt)}
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
