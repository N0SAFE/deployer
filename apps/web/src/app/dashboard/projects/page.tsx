'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { MOCK_PROJECTS, MOCK_SERVICES_BY_PROJECT } from '@/mocks/platform'
import { MOCK_DEPLOYMENTS, MOCK_INCIDENTS, MOCK_NOTIFICATIONS } from '@/mocks/platform/entities/operations.mock'
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
  // Mock state: projects and services from mock data, extended with additional fields
  const [projects, setProjects] = useState<ProjectForDisplay[]>(
    MOCK_PROJECTS.map((p) => ({
      ...p,
      baseDomain: undefined,
      ownerId: 'user-mock',
      updatedAt: new Date().toISOString(),
    })),
  )
  const [services] = useState(Object.values(MOCK_SERVICES_BY_PROJECT).flat())
  const [deployments] = useState(MOCK_DEPLOYMENTS)
  const [incidents] = useState(MOCK_INCIDENTS)
  const [notifications] = useState(MOCK_NOTIFICATIONS)
  const [searchQuery, setSearchQuery] = useState('')
  const [riskFilter, setRiskFilter] = useState<'all' | 'at-risk' | 'healthy'>('all')

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editProjectId, setEditProjectId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createBaseDomain, setCreateBaseDomain] = useState('')
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editBaseDomain, setEditBaseDomain] = useState('')

  const projectMetrics = useMemo(() => {
    const serviceCountByProjectId = new Map<string, number>()
    const deploymentCountByProjectId = new Map<string, number>()
    const latestDeploymentByProjectId = new Map<string, { status: string; createdAt: string; duration: string }>()
    const openIncidentCountByProjectId = new Map<string, number>()
    const latestNotificationByProjectId = new Map<string, { level: string; message: string; createdAt: string }>()

    for (const service of services) {
      serviceCountByProjectId.set(service.projectId, (serviceCountByProjectId.get(service.projectId) ?? 0) + 1)
    }

    for (const deployment of deployments) {
      const projectId = deployment.projectId

      deploymentCountByProjectId.set(projectId, (deploymentCountByProjectId.get(projectId) ?? 0) + 1)

      const current = latestDeploymentByProjectId.get(projectId)
      if (!current || new Date(deployment.startedAt).getTime() > new Date(current.createdAt).getTime()) {
        latestDeploymentByProjectId.set(projectId, {
          status: deployment.status,
          createdAt: deployment.startedAt,
          duration: computeDurationLabel(deployment.startedAt, deployment.finishedAt),
        })
      }
    }

    for (const incident of incidents) {
      if (incident.status !== 'open') continue
      openIncidentCountByProjectId.set(incident.projectId, (openIncidentCountByProjectId.get(incident.projectId) ?? 0) + 1)
    }

    for (const notification of notifications) {
      const current = latestNotificationByProjectId.get(notification.projectId)
      if (!current || new Date(notification.createdAt).getTime() > new Date(current.createdAt).getTime()) {
        latestNotificationByProjectId.set(notification.projectId, {
          level: notification.level,
          message: notification.message,
          createdAt: notification.createdAt,
        })
      }
    }

    return {
      serviceCountByProjectId,
      deploymentCountByProjectId,
      latestDeploymentByProjectId,
      openIncidentCountByProjectId,
      latestNotificationByProjectId,
    }
  }, [deployments, incidents, notifications, services])

  const filteredProjects = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return projects.filter((project) => {
      const openIncidents = projectMetrics.openIncidentCountByProjectId.get(project.id) ?? 0
      const latestDeployment = projectMetrics.latestDeploymentByProjectId.get(project.id)
      const isAtRisk = openIncidents > 0 || latestDeployment?.status === 'failed'

      if (riskFilter === 'at-risk' && !isAtRisk) return false
      if (riskFilter === 'healthy' && isAtRisk) return false

      if (!query) return true
      return (
        project.name.toLowerCase().includes(query)
        || project.slug.toLowerCase().includes(query)
        || project.id.toLowerCase().includes(query)
        || project.organizationId.toLowerCase().includes(query)
      )
    })
  }, [projectMetrics.latestDeploymentByProjectId, projectMetrics.openIncidentCountByProjectId, projects, riskFilter, searchQuery])

  const serviceCount = services.length
  const openIncidents = incidents.filter((incident) => incident.status === 'open').length
  const criticalNotifications = notifications.filter((notification) => notification.level === 'critical').length

  const failedProjects = projects.filter((project) => {
    const latest = projectMetrics.latestDeploymentByProjectId.get(project.id)
    return latest?.status === 'failed'
  }).length

  const editingProject = projects.find((project) => project.id === editProjectId) ?? null

  const handleOpenEdit = (projectId: string) => {
    const project = projects.find((candidate) => candidate.id === projectId)
    if (!project) {
      return
    }

    setEditProjectId(project.id)
    setEditName(project.name)
    setEditDescription(project.description ?? '')
    setEditBaseDomain(project.baseDomain ?? '')
  }

  const handleCreateProject = () => {
    const name = createName.trim()

    if (!name) {
      toast.error('Project name is required')
      return
    }

    // Mock: create a new project with auto-generated ID
    const newProject = {
      id: `proj-${String(Date.now())}`,
      organizationId: 'org-mock',
      teamId: 'team-mock',
      slug: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      description: createDescription.trim() || undefined,
      baseDomain: createBaseDomain.trim() || undefined,
      ownerId: 'user-mock',
      updatedAt: new Date().toISOString(),
    }

    setProjects([...projects, newProject])
    toast.success('Project created')
    setCreateDialogOpen(false)
    setCreateName('')
    setCreateDescription('')
    setCreateBaseDomain('')
  }

  const handleUpdateProject = () => {
    if (!editingProject) {
      return
    }

    const name = editName.trim()
    if (!name) {
      toast.error('Project name is required')
      return
    }

    // Mock: update project
    setProjects(
      projects.map((p) =>
        p.id === editingProject.id
          ? {
              ...p,
              name,
              description: editDescription.trim() || undefined,
              baseDomain: editBaseDomain.trim() || undefined,
              updatedAt: new Date().toISOString(),
            }
          : p,
      ),
    )

    toast.success('Project updated')
    setEditProjectId(null)
  }

  const handleDeleteProject = (projectId: string) => {
    if (!confirm('Delete this project? This action cannot be undone.')) {
      return
    }

    // Mock: delete project
    setProjects(projects.filter((p) => p.id !== projectId))
    toast.success('Project deleted')
  }


  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Projects</h1>
          <p className="mt-2 text-muted-foreground">
            Browse projects, drill into services, and manage project/service configuration from one place.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/dashboard/deployments">
              Open global deployments
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button onClick={() => {setCreateDialogOpen(true)}} className="gap-2">
            <Plus className="size-4" />
            New project
          </Button>
        </div>
      </div>

      <div className="grid gap-2 md:grid-cols-[minmax(260px,1fr)_190px_1fr]">
        <Input
          value={searchQuery}
          onChange={(event) => {
            setSearchQuery(event.target.value)
          }}
          placeholder="Search projects, slugs, org IDs..."
        />
        <select
          className="h-9 rounded-md border border-border/70 bg-background px-3 text-sm"
          value={riskFilter}
          onChange={(event) => {
            setRiskFilter(event.target.value as typeof riskFilter)
          }}
        >
          <option value="all">All risk levels</option>
          <option value="at-risk">At risk</option>
          <option value="healthy">Healthy</option>
        </select>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{projects.length} projects</Badge>
          <Badge variant="outline">{serviceCount} services</Badge>
          <Badge variant={failedProjects > 0 ? 'destructive' : 'secondary'}>
            {failedProjects} projects with failed latest deploy
          </Badge>
          <Badge variant={openIncidents > 0 ? 'destructive' : 'secondary'}>
            <Siren className="mr-1 size-3" /> {openIncidents} open incidents
          </Badge>
          <Badge variant={criticalNotifications > 0 ? 'destructive' : 'outline'}>
            <Bell className="mr-1 size-3" /> {criticalNotifications} critical notifications
          </Badge>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
        {filteredProjects.map((project) => {
          const serviceCount = projectMetrics.serviceCountByProjectId.get(project.id) ?? 0
          const deploymentCount = projectMetrics.deploymentCountByProjectId.get(project.id) ?? 0
          const latestDeployment = projectMetrics.latestDeploymentByProjectId.get(project.id)
          const openIncidentCount = projectMetrics.openIncidentCountByProjectId.get(project.id) ?? 0
          const latestNotification = projectMetrics.latestNotificationByProjectId.get(project.id)
          const atRisk = openIncidentCount > 0 || latestDeployment?.status === 'failed'

          return (
            <Card key={project.id} className="border-border/60 bg-card/40 backdrop-blur-xl">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="truncate text-base">{project.name}</CardTitle>
                  <Badge variant={atRisk ? 'destructive' : 'secondary'}>
                    {atRisk ? 'at risk' : 'healthy'}
                  </Badge>
                </div>
                <CardDescription>
                  {project.description ?? 'No description'}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                    <p className="text-xs text-muted-foreground">Services</p>
                    <p className="font-semibold">{serviceCount}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                    <p className="text-xs text-muted-foreground">Deployments</p>
                    <p className="font-semibold">{deploymentCount}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                    <p className="text-xs text-muted-foreground">Open incidents</p>
                    <p className="font-semibold">{openIncidentCount}</p>
                  </div>
                  <div className="rounded-md border border-border/60 bg-muted/20 p-2">
                    <p className="text-xs text-muted-foreground">Last deploy duration</p>
                    <p className="font-semibold">{latestDeployment?.duration ?? '—'}</p>
                  </div>
                </div>

                <div className="space-y-1 text-xs text-muted-foreground">
                  <p className="font-mono">id: {shortId(project.id)}</p>
                  <p>owner: {project.ownerId}</p>
                  <p>updated: {formatDate(project.updatedAt)}</p>
                  <p>latest deployment: {latestDeployment ? formatDate(latestDeployment.createdAt) : '—'}</p>
                </div>

                <Alert>
                  <AlertTitle className="text-xs">Latest signal</AlertTitle>
                  <AlertDescription className="text-xs">
                    {latestNotification ? `${latestNotification.level.toUpperCase()}: ${latestNotification.message}` : 'No notifications yet.'}
                  </AlertDescription>
                </Alert>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button asChild variant="outline" className="justify-between">
                    <Link href={`/dashboard/projects/${project.id}`}>
                      Open project
                      <FolderKanban className="size-4" />
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="justify-between">
                    <Link href={`/dashboard/projects/${project.id}/configuration`}>
                      Configuration
                      <Settings className="size-4" />
                    </Link>
                  </Button>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Button
                    variant="outline"
                    className="justify-between"
                    onClick={() => {
                      handleOpenEdit(project.id)
                    }}
                  >
                    Edit
                    <Pencil className="size-4" />
                  </Button>

                  <Button
                    variant="destructive"
                    className="justify-between"
                    onClick={() => {
                      handleDeleteProject(project.id)
                    }}
                  >
                    Delete
                    <Trash2 className="size-4" />
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1">
                    <GitBranch className="size-3.5" /> Service graph ready
                  </span>
                  <span className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1">
                    <Rocket className="size-3.5" /> Release visibility
                  </span>
                  {latestDeployment ? (
                    <span className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1">
                      <Rocket className="size-3.5" /> Last status: {latestDeployment.status}
                    </span>
                  ) : null}
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
            <div className="space-y-2">
              <Label htmlFor="project-edit-domain">Base domain</Label>
              <Input
                id="project-edit-domain"
                value={editBaseDomain}
                onChange={(event) => {
                  setEditBaseDomain(event.target.value)
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
