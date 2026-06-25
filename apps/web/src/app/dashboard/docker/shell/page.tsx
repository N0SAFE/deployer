'use client'

import { useMemo, useState } from 'react'
import { DockerContainerDetailModalTrigger } from '../_components/container-detail-modal'
import { DockerInlineLoadingState, DockerTableLoadingRows } from '../_components/docker-loading-states'
import { DockerImageDetailModalTrigger } from '../_components/docker-image-detail-modal'
import {
  useDockerContainerList,
  useDockerImageList,
} from '@/domains/docker/hooks'
import { useDockerLiveRefetch } from '@/domains/docker/use-docker-live'
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
import type { DockerContainer } from '@repo/contracts-entities'

const DOCKER_LIST_INPUT = {
  query: {
    limit: 100,
    offset: 0,
  },
} as const

function formatDate(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function toBadgeVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const normalized = status.toLowerCase()
  if (normalized === 'running' || normalized === 'healthy') return 'default'
  if (normalized === 'dead' || normalized === 'exited' || normalized === 'failed' || normalized === 'error') return 'destructive'
  if (normalized === 'restarting' || normalized === 'created' || normalized === 'starting') {
    return 'secondary'
  }
  return 'outline'
}

interface ShellTarget {
  id: string
  containerName: string
  image: string
  imageId: string | null
  status: DockerContainer['status']
  environment: DockerContainer['environment']
  updatedAt: string
}

function fallbackImageRefFromId(imageId: string | null): string {
  if (!imageId) return 'unknown-image'
  if (imageId.startsWith('sha256:')) {
    return `sha256:${imageId.slice(7, 19)}`
  }
  return imageId.slice(0, 18)
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
    target.environment ?? 'unknown',
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
  const containerListQuery = useDockerContainerList(DOCKER_LIST_INPUT)
  const imageListQuery = useDockerImageList(DOCKER_LIST_INPUT)
  const { data: containerEntityData } = containerListQuery
  const { data: imageEntityData } = imageListQuery

  useDockerLiveRefetch({
    on: { container: ['create', 'update', 'destroy', 'die', 'start', 'stop', 'restart', 'kill', 'pause', 'unpause', 'rename', 'attach', 'detach'] },
    onData: () => {
      void imageListQuery.refetch()
      void containerListQuery.refetch()
    },
    debounceMs: 900,
  })

  const containerEntities = useMemo(() => containerEntityData?.data ?? [], [containerEntityData?.data])
  const containerEntityById = useMemo(
    () => new Map(containerEntities.map((container) => [container.id, container])),
    [containerEntities],
  )
  const imageEntities = useMemo(() => imageEntityData?.data ?? [], [imageEntityData?.data])

  const shellTargets = useMemo<ShellTarget[]>(() => {
    const imageById = new Map(imageEntities.map((image) => [image.id, image]))

    return containerEntities
      .map((container) => {
        const imageEntity = container.imageId ? imageById.get(container.imageId) : null
        const image = imageEntity
          ? `${imageEntity.registry}/${imageEntity.repository}${imageEntity.tag ? `:${imageEntity.tag}` : ''}`
          : fallbackImageRefFromId(container.imageId)

        return {
          id: container.id,
          containerName: container.name,
          image,
          imageId: container.imageId,
          status: container.status,
          environment: container.environment,
          updatedAt: container.updatedAt,
        }
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }, [containerEntities, imageEntities])

  const filteredTargets = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return shellTargets.filter((target) => {
      if (!query) return true
      return (
        target.containerName.toLowerCase().includes(query)
        || target.image.toLowerCase().includes(query)
        || (target.environment ?? '').toLowerCase().includes(query)
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
  const isInitialLoading = (containerListQuery.isLoading || imageListQuery.isLoading) && shellTargets.length === 0

  return (
    <div className="space-y-6">
      {isInitialLoading ? <DockerInlineLoadingState label="Loading shell targets from runtime containers…" /> : null}
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
              {isInitialLoading ? (
                <DockerTableLoadingRows columns={5} rows={6} />
              ) : filteredTargets.slice(0, 20).map((target) => (
                <TableRow
                  key={target.id}
                  className={selectedContainer === target.containerName ? 'bg-muted/60' : undefined}
                  onClick={() => setSelectedContainer(target.containerName)}
                >
                  <TableCell className="font-medium">
                    <DockerContainerDetailModalTrigger
                      id={target.id}
                      container={containerEntityById.get(target.id)}
                    >
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
              {!isInitialLoading && filteredTargets.length === 0 ? (
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
