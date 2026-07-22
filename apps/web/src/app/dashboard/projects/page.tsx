'use client'

import Link from 'next/link'
import { AuthDashboardDeployments } from '@/routes'
import { useMemo, useState } from 'react'
import { useProjectList, useCreateProject, useUpdateProject } from '@/domains/project/hooks'
import { Alert, AlertDescription, AlertTitle } from '@repo/ui/components/shadcn/alert'
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@repo/ui/components/shadcn/card'
import { ArrowRight, Bell, FolderKanban, GitBranch, Pencil, Plus, Rocket, Settings, Siren, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface ProjectForDisplay {
  id: string
  organizationId: string
  teamId: string
  slug: string
  name: string
  description?: string
  baseDomain?: string
  ownerId: string
  updatedAt: string
}


function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString()
}

function computeDurationLabel(startedAt: string, finishedAt?: string): string {
  const start = new Date(startedAt).getTime()
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now()
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return '—'

  const durationSeconds = Math.floor((end - start) / 1000)
  const minutes = Math.floor(durationSeconds / 60)
  const seconds = durationSeconds % 60
  return `${String(minutes)}m ${String(seconds)}s`
}

export default function DashboardProjectsPage() {
  const { data: projectsData, isLoading, error } = useProjectList(undefined)
  const createProject = useCreateProject()
  const updateProject = useUpdateProject()

  const [searchQuery, setSearchQuery] = useState('')
  const [riskFilter, setRiskFilter] = useState<'all' | 'at-risk' | 'healthy'>('all')

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editProjectId, setEditProjectId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

  const projects = useMemo(() => projectsData ?? [], [projectsData])

  const filteredProjects = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!Array.isArray(projects)) return []
    return projects.filter((project: { name?: string; id?: string }) => {
      if (!query) return true
      const name = (project.name ?? '').toLowerCase()
      const id = (project.id ?? '').toLowerCase()
      return name.includes(query) || id.includes(query)
    })
  }, [projects, riskFilter, searchQuery])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Siren className="mb-4 size-12 text-destructive" />
        <h2 className="text-xl font-semibold">Failed to load projects</h2>
        <p className="mt-2 text-muted-foreground">{(error as Error).message ?? 'An unexpected error occurred'}</p>
        <Button className="mt-4" variant="outline" onClick={() => window.location.reload()}>Retry</Button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 size-8 animate-spin rounded-full border-4 border-border border-t-primary" />
        <p className="text-muted-foreground">Loading projects...</p>
      </div>
    )
  }

  const failedProjects = Array.isArray(projects)
    ? projects.filter((p: Record<string, unknown>) => {
        const dep = p.latestDeployment as Record<string, unknown> | undefined
        return dep?.status === 'failed'
      }).length
    : 0

  const editingProject = Array.isArray(projects)
    ? projects.find((p: Record<string, unknown>) => p.id === editProjectId) ?? null
    : null

  const handleOpenEdit = (projectId: string) => {
    const project = Array.isArray(projects) ? projects.find((p: Record<string, unknown>) => p.id === projectId) : null
    if (!project) return
    setEditProjectId(projectId)
    setEditName((project as Record<string, string>).name ?? '')
    setEditDescription((project as Record<string, string>).description ?? '')
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="mt-2 text-muted-foreground">
            Browse projects, drill into services, and manage project/service configuration from one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <AuthDashboardDeployments.Link>
              Open global deployments
              <ArrowRight className="ml-2 size-4" />
            </AuthDashboardDeployments.Link>
          </Button>
          <Button onClick={() => {setCreateDialogOpen(true)}} className="gap-2">
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_1fr]">
        <Input
          value={searchQuery}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            setSearchQuery(event.target.value)
          }}
          placeholder="Search projects..."
        />
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{Array.isArray(projects) ? projects.length : 0} projects</Badge>
          <Badge variant={failedProjects > 0 ? 'destructive' : 'secondary'}>
            {failedProjects} projects with failed latest deploy
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {filteredProjects.map((project: Record<string, unknown>) => {
          const id = project.id as string
          const name = (project.name as string) ?? id
          const description = (project.description as string | null) ?? 'No description'
          const updatedAt = (project.updatedAt as string) ?? new Date().toISOString()

          return (
            <Card key={id} className="border-border/60 bg-card/40 backdrop-blur-xl">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-base">{name}</CardTitle>
                </div>
                <CardDescription>
                  {description}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="font-mono">id: {shortId(id)}</p>
                  <p>updated: {formatDate(updatedAt)}</p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button asChild variant="outline" className="justify-between">
                    <Link href={`/dashboard/projects/${id}`}>
                      Open project
                      <FolderKanban className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="justify-between">
                    <Link href={`/dashboard/projects/${id}/configuration`}>
                      Configuration
                      <Settings className="size-4" />
                    </Link>
                  </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    className="justify-between"
                    onClick={() => { handleOpenEdit(id) }}
                  >
                    Edit
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="destructive"
                    className="justify-between"
                    onClick={() => { toast.info('Delete via API not yet implemented') }}
                  >
                    Delete
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      {filteredProjects.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No projects match current filters.
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create project</DialogTitle>
            <DialogDescription>
              Define a new project boundary that will own services, deployments, and dependency policies.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-create-name">Name</Label>
              <Input
                id="project-create-name"
                value={createName}
                onChange={(event) => {
                  setCreateName(event.target.value)
                }}
                placeholder="my-project"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-create-description">Description</Label>
              <Input
                id="project-create-description"
                value={createDescription}
                onChange={(event) => {
                  setCreateDescription(event.target.value)
                }}
                placeholder="Short description"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-create-domain">Base domain</Label>
              <Input
                id="project-create-domain"
                value={createBaseDomain}
                onChange={(event) => {
                  setCreateBaseDomain(event.target.value)
                }}
                placeholder="apps.example.com"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {setCreateDialogOpen(false)}}>
              Cancel
            </Button>
            <Button onClick={() => {handleCreateProject()}}>
              Create project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editingProject)} onOpenChange={(open) => {
        if (!open) {
          setEditProjectId(null)
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit project</DialogTitle>
            <DialogDescription>
              Update project identity and domain-level metadata.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="project-edit-name">Name</Label>
              <Input
                id="project-edit-name"
                value={editName}
                onChange={(event) => {
                  setEditName(event.target.value)
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-edit-description">Description</Label>
              <Input
                id="project-edit-description"
                value={editDescription}
                onChange={(event) => {
                  setEditDescription(event.target.value)
                }}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {setEditProjectId(null)}}>
              Cancel
            </Button>
            <Button onClick={() => {handleUpdateProject()}}>
              Save project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
