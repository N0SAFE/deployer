'use client'

import { AuthDashboardDeployments, AuthDashboardProjectsProjectId, AuthDashboardProjectsProjectIdConfiguration } from '@/routes'
import { useMemo, useState } from 'react'
import { useProjectList, useCreateProject, useUpdateProject, useDeleteProject } from '@/domains/project/hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@repo/ui/components/shadcn/dialog'
import { Input } from '@repo/ui/components/shadcn/input'
import { Label } from '@repo/ui/components/shadcn/label'
import { Card, CardContent, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowRight, FolderKanban, Pencil, Plus, Search, Settings, Siren, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader, PageLoadingState, PageErrorState, EmptyState } from '@/components/dashboard'
import { formatDate, shortId } from './[projectId]/_utils/helpers'

interface ProjectRow {
  id: string
  name?: string
  description?: string | null
  updatedAt?: string
  latestDeployment?: { status?: string } | null
}

export default function DashboardProjectsPage() {
  const { data: projectsData, isLoading, error, refetch } = useProjectList({ query: { limit: 50, offset: 0 } })
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()
  const deleteProject = useDeleteProject()

  const [searchQuery, setSearchQuery] = useState('')
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editProjectId, setEditProjectId] = useState<string | null>(null)
  const [deleteProjectId, setDeleteProjectId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const projects = useMemo<ProjectRow[]>(() => {
    const d = projectsData as { data?: unknown[] } | undefined
    return Array.isArray(d?.data) ? (d.data as ProjectRow[]) : []
  }, [projectsData])

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (projects.length === 0 || !query) return projects
    return projects.filter((project) => {
      const name = project.name?.toLowerCase() ?? ''
      const id = project.id?.toLowerCase() ?? ''
      return name.includes(query) || id.includes(query)
    })
  }, [projects, searchQuery])

  if (error) {
    return (
      <PageErrorState
        title="Failed to load projects"
        message={(error as Error).message ?? 'An unexpected error occurred'}
        onRetry={() => void refetch()}
      />
    )
  }

  if (isLoading) {
    return <PageLoadingState label="Loading projects…" />
  }

  const editingProject = projects.find((p) => p.id === editProjectId) ?? null
  const deletingProject = projects.find((p) => p.id === deleteProjectId) ?? null

  const handleOpenEdit = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    setEditProjectId(projectId)
    setEditName(project.name ?? '')
    setEditDescription(project.description ?? '')
  }

  const handleCreateProject = async () => {
    const name = createName.trim()
    if (!name) { toast.error('Project name is required'); return }
    try {
      await createProject.mutateAsync({ name, description: createDescription.trim() || null })
      toast.success('Project created')
      setCreateDialogOpen(false)
      setCreateName('')
      setCreateDescription('')
    } catch (err) {
      toast.error('Failed to create project', { description: (err as Error).message })
    }
  }

  const handleUpdateProject = async () => {
    if (!editProjectId) return
    try {
      await updateProject.mutateAsync({ id: editProjectId, name: editName.trim(), description: editDescription.trim() || null })
      toast.success('Project updated')
      setEditProjectId(null)
    } catch (err) {
      toast.error('Failed to update project', { description: (err as Error).message })
    }
  }

  const handleDeleteProject = async () => {
    if (!deleteProjectId) return
    try {
      await deleteProject.mutateAsync({ params: { id: deleteProjectId } })
      toast.success('Project deleted')
      setDeleteProjectId(null)
    } catch (err) {
      toast.error('Failed to delete project', { description: (err as Error).message })
    }
  }

  const hasActiveFilters = searchQuery.trim().length > 0

  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <PageHeader
        eyebrow="Projects"
        title="Projects"
        description="Organize services and infrastructure into deployable units."
        actions={
          <>
            <Button asChild variant="outline">
              <AuthDashboardDeployments.Link>
                <ArrowRight className="mr-1.5 size-3.5" />
                Deployments
              </AuthDashboardDeployments.Link>
            </Button>
            <Button onClick={() => { setCreateDialogOpen(true) }} className="gap-2">
              <Plus className="size-4" />
              New project
            </Button>
          </>
        }
      />

      {/* ── Search + count ── */}
      <div className="flex items-center gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
            placeholder="Search projects..."
            className="pl-9"
            aria-label="Search projects"
          />
        </div>
        <Badge variant="outline">{projects.length} projects</Badge>
      </div>

      {/* ── Project grid ── */}
      {filteredProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={projects.length === 0 ? 'No projects yet' : 'No projects match your search'}
          description={projects.length === 0
            ? 'Create your first project to start deploying services.'
            : 'Try adjusting your search.'}
          action={
            projects.length === 0
              ? { label: 'Create your first project', onClick: () => setCreateDialogOpen(true) }
              : { label: 'Clear filters', onClick: () => setSearchQuery('') }
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {filteredProjects.map((project) => {
            const id = project.id
            const name = project.name ?? id
            const updatedAt = project.updatedAt ?? new Date().toISOString()
            const depStatus = project.latestDeployment?.status

            return (
              <Card key={id} className="border-border/60 bg-card/40 backdrop-blur-xl transition-all hover:border-primary/40 hover:bg-card/60">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between gap-2">
                    <AuthDashboardProjectsProjectId.Link projectId={id}>
                      <CardTitle className="truncate text-sm font-semibold hover:underline">{name}</CardTitle>
                    </AuthDashboardProjectsProjectId.Link>
                    {depStatus ? (
                      <Badge variant={depStatus === 'failed' ? 'destructive' : depStatus === 'running' ? 'secondary' : 'outline'} className="shrink-0 text-[10px] capitalize">
                        {depStatus}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="shrink-0 text-[10px]">idle</Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 pt-0">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">{shortId(id)}</span>
                    <span>{formatDate(updatedAt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <AuthDashboardProjectsProjectIdConfiguration.Link projectId={id}>
                      <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-[11px]">
                        <span>
                          <Settings className="mr-1 size-3" />
                          Configure
                        </span>
                      </Button>
                    </AuthDashboardProjectsProjectIdConfiguration.Link>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => handleOpenEdit(id)}
                        aria-label={`Edit ${name}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-destructive hover:text-destructive"
                        onClick={() => setDeleteProjectId(id)}
                        aria-label={`Delete ${name}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-create-name">Name</Label>
              <Input
                id="project-create-name"
                value={createName}
                onChange={(event) => { setCreateName(event.target.value) }}
                placeholder="my-project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-create-description">Description</Label>
              <Input
                id="project-create-description"
                value={createDescription}
                onChange={(event) => { setCreateDescription(event.target.value) }}
                placeholder="Short description"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateDialogOpen(false) }}>
              Cancel
            </Button>
            <Button onClick={() => { void handleCreateProject() }} disabled={createProject.isPending}>
              {createProject.isPending ? 'Creating...' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingProject)} onOpenChange={(open) => {
        if (!open) { setEditProjectId(null) }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-edit-name">Name</Label>
              <Input
                id="project-edit-name"
                value={editName}
                onChange={(event) => { setEditName(event.target.value) }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-edit-description">Description</Label>
              <Input
                id="project-edit-description"
                value={editDescription}
                onChange={(event) => { setEditDescription(event.target.value) }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditProjectId(null) }}>
              Cancel
            </Button>
            <Button onClick={() => { void handleUpdateProject() }} disabled={updateProject.isPending}>
              {updateProject.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <Dialog open={Boolean(deletingProject)} onOpenChange={(open) => {
        if (!open) { setDeleteProjectId(null) }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete project</DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{deletingProject?.name ?? 'this project'}</strong> and all its
              services, environments, and deployments. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteProjectId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleDeleteProject()} disabled={deleteProject.isPending}>
              {deleteProject.isPending ? 'Deleting...' : 'Delete project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
