'use client'

import { useMemo, useState } from 'react'
import {
  AuthDashboardDeployments,
  AuthDashboardProjectsProjectId,
  AuthDashboardProjectsProjectIdConfiguration,
} from '@/routes'
import { useProjectList, useCreateProject, useUpdateProject, useDeleteProject } from '@/domains/project/hooks'
import { useServiceList } from '@/domains/service/hooks'
import { useDeploymentList } from '@/domains/deployment/hooks'
import { Button } from '@repo/ui/components/shadcn/button'
import { Card, CardContent } from '@repo/ui/components/shadcn/card'
import { Input } from '@repo/ui/components/shadcn/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@repo/ui/components/shadcn/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@repo/ui/components/shadcn/table'
import { FolderKanban, Pencil, Plus, Search, Settings, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  PageHeader, PageErrorState, EmptyState, FilteredEmptyState, ScopeLabel, StatStrip, StatStripItem, StatusBadge,
} from '@/components/dashboard'
import { PageSkeleton } from '@/components/dashboard/Skeletons'
import { useSlowLoading, errorReason } from './_components/workload/WorkloadStates'
import { RelativeTime } from './_components/workload/RelativeTime'
import { IdChip } from './_components/workload/CopyButton'
import { ProjectFormDialog, DeleteProjectDialog } from './_components/list/project-dialogs'
import {
  buildProjectGlance, matchesProjectQuery, sortProjects, type ProjectSortKey,
} from './_utils/project-overview'

type DialogState =
  | { kind: 'none' }
  | { kind: 'create' }
  | { kind: 'edit'; id: string }
  | { kind: 'delete'; id: string }

const DEPLOYMENT_WINDOW = 100

export default function DashboardProjectsPage() {
  const projectsQuery = useProjectList({ query: { limit: 100, offset: 0 } })
  const servicesQuery = useServiceList({ query: { limit: 100, offset: 0 } })
  const deploymentsQuery = useDeploymentList({ query: { limit: DEPLOYMENT_WINDOW, offset: 0 } })
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<ProjectSortKey>('updated')
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' })

  const projects = useMemo(() => projectsQuery.data?.data ?? [], [projectsQuery.data])
  const services = useMemo(() => servicesQuery.data?.data ?? [], [servicesQuery.data])
  const deployments = useMemo(() => deploymentsQuery.data?.data ?? [], [deploymentsQuery.data])

  const glance = useMemo(() => buildProjectGlance(projects, services, deployments), [projects, services, deployments])
  const visible = useMemo(
    () => sortProjects(projects.filter((p) => matchesProjectQuery(p, search)), sort, glance),
    [projects, search, sort, glance],
  )

  const slow = useSlowLoading(projectsQuery.isLoading)

  if (projectsQuery.error) {
    return (
      <PageErrorState
        title="Could not load projects"
        message={errorReason(projectsQuery.error)}
        onRetry={() => void projectsQuery.refetch()}
      />
    )
  }

  if (projectsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <PageSkeleton label="Loading projects" blocks={1} withStrip={false} />
        {slow ? (
          <p role="status" className="text-sm font-medium text-status-pending">
            Still loading — waiting on the platform API to return your projects. It may be starting.
          </p>
        ) : null}
      </div>
    )
  }

  const editing = dialog.kind === 'edit' ? projects.find((p) => p.id === dialog.id) ?? null : null
  const deleting = dialog.kind === 'delete' ? projects.find((p) => p.id === dialog.id) ?? null : null
  const closeDialog = () => { setDialog({ kind: 'none' }) }

  const handleCreate = async (values: { name: string; description: string }) => {
    try {
      await createProject.mutateAsync({ name: values.name, description: values.description || null })
      toast.success(`Project “${values.name}” created`)
      closeDialog()
    } catch (err) {
      toast.error('Could not create the project', { description: errorReason(err) })
    }
  }

  const handleUpdate = async (values: { name: string; description: string }) => {
    if (!editing) return
    try {
      await updateProject.mutateAsync({ id: editing.id, name: values.name, description: values.description || null })
      toast.success('Project updated')
      closeDialog()
    } catch (err) {
      toast.error('Could not update the project', { description: errorReason(err) })
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await deleteProject.mutateAsync({ params: { id: deleting.id } })
      toast.success(`Project “${deleting.name}” deleted`)
      closeDialog()
    } catch (err) {
      toast.error('Could not delete the project', { description: errorReason(err) })
    }
  }

  const failedCount = projects.filter((p) => glance.get(p.id)?.lastDeployment?.status === 'failed').length
  const hasFilters = search.trim().length > 0
  // Deployment and service lists are separate queries: say so if one failed rather
  // than rendering "0 services" as a fact.
  const glanceUnavailable = servicesQuery.isError || deploymentsQuery.isError
  const windowFull = deployments.length >= DEPLOYMENT_WINDOW

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Workloads"
        title="Projects"
        description="A project groups the services, environments and domains of one product. Open one to deploy, configure or watch its services."
        badge={<ScopeLabel scope="mesh" />}
        actions={
          <>
            <Button asChild variant="outline">
              <AuthDashboardDeployments.Link>All deployments</AuthDashboardDeployments.Link>
            </Button>
            <Button onClick={() => { setDialog({ kind: 'create' }) }}>
              <Plus className="mr-1.5 size-4" />
              New project
            </Button>
          </>
        }
      />

      {projects.length > 0 ? (
        <StatStrip>
          <StatStripItem icon={FolderKanban} label="Projects" value={projects.length} />
          <StatStripItem
            label="Last deploy failed"
            value={glanceUnavailable ? undefined : failedCount}
            tone={failedCount > 0 ? 'danger' : undefined}
            hint={glanceUnavailable ? 'deployment data unavailable' : failedCount > 0 ? 'needs attention' : 'none'}
          />
        </StatStrip>
      ) : null}

      {glanceUnavailable ? (
        <p role="status" className="text-sm text-status-pending">
          Service counts and last deployments could not be loaded, so they show “—”.{' '}
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0"
            onClick={() => { void servicesQuery.refetch(); void deploymentsQuery.refetch() }}
          >
            Retry
          </Button>
        </p>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="A project is where your services live. Create one, then add a service from a Git repository, an image or an upload."
          action={{ label: 'Create your first project', onClick: () => { setDialog({ kind: 'create' }) } }}
        />
      ) : (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-52 max-w-sm flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => { setSearch(event.target.value) }}
                  placeholder="Search by name, description or id"
                  className="pl-9"
                  aria-label="Search projects"
                />
              </div>
              <Select value={sort} onValueChange={(value) => { setSort(value as ProjectSortKey) }}>
                <SelectTrigger className="w-48" aria-label="Sort projects">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Recently updated</SelectItem>
                  <SelectItem value="lastDeploy">Last deployment</SelectItem>
                  <SelectItem value="name">Name (A–Z)</SelectItem>
                  <SelectItem value="created">Newest first</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground" role="status">
                {visible.length} of {projects.length}
              </span>
            </div>

            {visible.length === 0 ? (
              <FilteredEmptyState
                label="No project matches your search."
                onClear={hasFilters ? () => { setSearch('') } : undefined}
              />
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader className="sticky top-0 bg-card">
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead className="text-right">Services</TableHead>
                      <TableHead>Last deployment</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((project) => {
                      const g = glance.get(project.id)
                      const last = g?.lastDeployment ?? null
                      return (
                        <TableRow key={project.id} className="hover:bg-muted/40">
                          <TableCell className="max-w-72">
                            <AuthDashboardProjectsProjectId.Link projectId={project.id} className="font-medium hover:underline">
                              {project.name}
                            </AuthDashboardProjectsProjectId.Link>
                            {project.description ? (
                              <p className="truncate text-sm text-muted-foreground">{project.description}</p>
                            ) : null}
                            <IdChip id={project.id} label={`Copy id of ${project.name}`} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {glanceUnavailable ? '—' : g?.servicesCount ?? 0}
                          </TableCell>
                          <TableCell>
                            {glanceUnavailable ? (
                              <span className="text-muted-foreground">—</span>
                            ) : last ? (
                              <div className="flex flex-wrap items-center gap-2">
                                <StatusBadge status={last.status} />
                                <RelativeTime value={last.createdAt} className="text-sm text-muted-foreground" />
                              </div>
                            ) : (
                              <span className="text-sm text-muted-foreground">
                                {windowFull ? 'Not in the latest deployments' : 'Never deployed'}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <RelativeTime value={project.updatedAt} className="text-sm text-muted-foreground" />
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center justify-end gap-1">
                              <Button asChild variant="outline" size="sm">
                                <AuthDashboardProjectsProjectId.Link projectId={project.id}>Open</AuthDashboardProjectsProjectId.Link>
                              </Button>
                              <Button asChild variant="ghost" size="icon" className="size-8">
                                <AuthDashboardProjectsProjectIdConfiguration.Link
                                  projectId={project.id}
                                  aria-label={`Settings of ${project.name}`}
                                  title="Settings"
                                >
                                  <Settings className="size-4" />
                                </AuthDashboardProjectsProjectIdConfiguration.Link>
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                aria-label={`Rename ${project.name}`}
                                title="Rename"
                                onClick={() => { setDialog({ kind: 'edit', id: project.id }) }}
                              >
                                <Pencil className="size-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="size-8 text-destructive hover:text-destructive"
                                aria-label={`Delete ${project.name}`}
                                title="Delete"
                                onClick={() => { setDialog({ kind: 'delete', id: project.id }) }}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {dialog.kind === 'create' ? (
        <ProjectFormDialog
          mode="create"
          initial={{ name: '', description: '' }}
          pending={createProject.isPending}
          onSubmit={(values) => void handleCreate(values)}
          onClose={closeDialog}
        />
      ) : null}
      {editing ? (
        <ProjectFormDialog
          mode="edit"
          initial={{ name: editing.name, description: editing.description ?? '' }}
          pending={updateProject.isPending}
          onSubmit={(values) => void handleUpdate(values)}
          onClose={closeDialog}
        />
      ) : null}
      {deleting ? (
        <DeleteProjectDialog
          name={deleting.name}
          servicesCount={glance.get(deleting.id)?.servicesCount ?? 0}
          pending={deleteProject.isPending}
          onConfirm={() => void handleDelete()}
          onClose={closeDialog}
        />
      ) : null}
    </div>
  )
}
