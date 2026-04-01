'use client'

import { useMemo, useState } from 'react'
import { DockerContainerDetailModalTrigger } from '../_components/docker-container-detail-modal'
import { DockerImageDetailModalTrigger } from '../_components/docker-image-detail-modal'
import { useDockerContainerList, useDockerDeploymentList, useDockerImageList } from '@/domains/docker/mock-hooks'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Input } from '@repo/ui/components/shadcn/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@repo/ui/components/shadcn/table'
import { Play, Search, Square, TerminalSquare } from 'lucide-react'
import type { Deployment } from '@repo/contracts-entities'

const DEPLOYMENT_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

function shortId(id: string): string {
  return id.slice(0, 8)
}

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'success' || normalized === 'active' || normalized === 'healthy') return 'default'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'down') return 'destructive'
  if (normalized === 'pending' || normalized === 'queued' || normalized === 'building' || normalized === 'deploying') {
    return 'secondary'
  }
  return 'outline'
}

interface ShellTarget {
  id: string
  containerName: string
  image: string
  imageId: string | null
  status: Deployment['status']
  environment: Deployment['environment']
  updatedAt: string
}

function normalizeImageRef(imageRef: string): string {
  return imageRef.trim().split('@')[0] ?? imageRef.trim()
}

function buildShellTranscript(target: ShellTarget | null): string {
  if (!target) {
    return [
      '$ docker exec -it <container> /bin/sh',
      '# waiting for target selection…',
      '# select a container and click Connect',
    ].join('\n')
  }

  return [
    `$ docker exec -it ${target.containerName} /bin/sh`,
    '$ whoami',
    'root',
    '$ pwd',
    '/app',
    '$ printenv NODE_ENV',
    target.environment,
    '$ cat /etc/hostname',
    target.containerName,
    '$ echo "attached image"',
    target.image,
  ].join('\n')
}

export default function DashboardDockerShellPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedContainer, setSelectedContainer] = useState<string | null>(null)
  const [connectedContainerId, setConnectedContainerId] = useState<string | null>(null)
  const { data: deploymentData } = useDockerDeploymentList(DEPLOYMENT_LIST_INPUT)
  const { data: containerEntityData } = useDockerContainerList(DEPLOYMENT_LIST_INPUT)
  const { data: imageEntityData } = useDockerImageList(DEPLOYMENT_LIST_INPUT)
  const deployments = useMemo(() => deploymentData?.data ?? [], [deploymentData?.data])
  const containerEntities = useMemo(() => containerEntityData?.data ?? [], [containerEntityData?.data])
  const imageEntities = useMemo(() => imageEntityData?.data ?? [], [imageEntityData?.data])

  const shellTargets = useMemo<ShellTarget[]>(() => {
    const containerIdByName = new Map(containerEntities.map((container) => [container.name, container.id]))
    const imageIdByRef = new Map(
      imageEntities.map((image) => [
        `${image.registry}/${image.repository}${image.tag ? `:${image.tag}` : ''}`,
        image.id,
      ]),
    )

    return deployments
      .map((deployment) => ({
        containerName: deployment.containerName ?? `deployment-${shortId(deployment.id)}`,
        id:
          containerIdByName.get(deployment.containerName ?? `deployment-${shortId(deployment.id)}`)
          ?? deployment.id,
        image: deployment.containerImage ?? 'unresolved-image',
        imageId: imageIdByRef.get(normalizeImageRef(deployment.containerImage ?? '')) ?? null,
        status: deployment.status,
        environment: deployment.environment,
        updatedAt: deployment.updatedAt,
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [containerEntities, deployments, imageEntities])

  const filteredTargets = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return shellTargets.filter((target) => {
      if (!query) return true
      return (
        target.containerName.toLowerCase().includes(query)
        || target.image.toLowerCase().includes(query)
        || target.environment.toLowerCase().includes(query)
      )
    })
  }, [searchTerm, shellTargets])

  const selectedTarget = useMemo(
    () => filteredTargets.find((target) => target.containerName === selectedContainer) ?? null,
    [filteredTargets, selectedContainer],
  )

  const connectedTarget = useMemo(
    () => shellTargets.find((target) => target.id === connectedContainerId) ?? null,
    [connectedContainerId, shellTargets],
  )

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-2xl border border-border/60 bg-card/50 backdrop-blur-xl">
        <div className="border-b border-border/60 bg-background/70 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">Shell</h2>
              <Badge variant="secondary" className="border border-border/70">{filteredTargets.length}</Badge>
            </div>

            <div className="grid w-full gap-2 md:w-auto md:grid-cols-[minmax(260px,1fr)_auto_auto]">
              <div className="relative min-w-65">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchTerm}
                  onChange={(event) => {
                    setSearchTerm(event.target.value)
                  }}
                  placeholder="Search containers..."
                  className="h-9 border-border/70 bg-background/70 pl-9"
                />
              </div>

              <Button
                type="button"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => {
                  const target = selectedTarget ?? filteredTargets[0] ?? null
                  setConnectedContainerId(target?.id ?? null)
                }}
              >
                <Play className="h-3.5 w-3.5" />
                Connect
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setConnectedContainerId(null)}
              >
                <Square className="h-3.5 w-3.5" />
                Disconnect
              </Button>
            </div>
          </div>
        </div>

        <div className="border-b border-border/60 bg-black/90 px-4 py-3 font-mono text-xs text-emerald-300">
          <div className="flex items-center gap-2 text-emerald-200/80">
            <TerminalSquare className="h-3.5 w-3.5" />
            {connectedTarget ? `Connected: ${connectedTarget.containerName}` : 'No active shell session'}
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap leading-5">
{buildShellTranscript(connectedTarget)}
          </pre>
        </div>

        <div className="p-4">
          <h3 className="mb-2 text-sm font-semibold">Target containers</h3>
          <p className="text-xs text-muted-foreground">Latest container targets for shell attach preparation.</p>

          <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Container</TableHead>
                <TableHead>Image</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredTargets.slice(0, 20).map((target) => (
                <TableRow
                  key={target.id}
                  className={selectedContainer === target.containerName ? 'bg-muted/60' : undefined}
                  onClick={() => setSelectedContainer(target.containerName)}
                >
                  <TableCell className="font-medium">
                    <DockerContainerDetailModalTrigger id={target.id}>
                      {target.containerName}
                    </DockerContainerDetailModalTrigger>
                  </TableCell>
                    <TableCell className="font-mono text-xs break-all">
                      {target.imageId ? (
                        <DockerImageDetailModalTrigger id={target.imageId}>
                          {target.image}
                        </DockerImageDetailModalTrigger>
                      ) : (
                        target.image
                      )}
                    </TableCell>
                  <TableCell>
                    <Badge variant={toBadgeVariant(target.status)}>{target.status}</Badge>
                  </TableCell>
                  <TableCell>{target.environment}</TableCell>
                  <TableCell>{formatDate(target.updatedAt)}</TableCell>
                </TableRow>
              ))}
              {filteredTargets.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                    No container targets available yet.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          </div>
        </div>
      </section>
    </div>
  )
}
