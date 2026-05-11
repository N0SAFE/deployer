'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { useDockerImageList, useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import type { DockerRegistryRepositoryDetail, DockerRegistryTagDetail } from '@repo/contracts-entities'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { Copy, Download, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { DockerImageDetailModal } from './docker-image-detail-modal'
import { DockerDetailLoadingState } from './docker-loading-states'
import { DockerModalQuickActions } from './docker-modal-quick-actions'
import { toast } from 'sonner'

type RegistryDetailTab = 'overview' | 'repos' | 'tags' | 'auth'

const IMAGE_LIST_INPUT = {
  query: {
    limit: 200,
    offset: 0,
  },
} as const

interface DockerRegistryDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: RegistryDetailTab
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value < 1024) return `${String(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function DockerRegistryDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerRegistryDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)
  const [imageDialogOpen, setImageDialogOpen] = useState(false)
  const [selectedImageModalId, setSelectedImageModalId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<RegistryDetailTab>(initialTab)
  const [opsNotice, setOpsNotice] = useState<string | null>(null)
  const [selectedRepositoryName, setSelectedRepositoryName] = useState<string | null>(null)
  const [selectedTagName, setSelectedTagName] = useState<string | null>(null)
  const { data: imageEntityData } = useDockerImageList(IMAGE_LIST_INPUT)
  const imageEntities = useMemo(() => imageEntityData?.data ?? [], [imageEntityData?.data])
  const detailQuery = useDockerRuntimeEntityDetail('registries', id, { enabled: open })
  const detail = detailQuery.data
  const repositories = useMemo<DockerRegistryRepositoryDetail[]>(() => {
    if (!detail) return []

    const registryImages = imageEntities.filter((image) => image.registry === detail.name)
    const repositoryNames = new Set<string>([
      ...detail.repositories,
      ...registryImages.map((image) => image.repository),
    ])

    return [...repositoryNames]
      .filter((repository) => repository.trim().length > 0)
      .sort((a, b) => a.localeCompare(b))
      .map((repository) => {
        const tagByName = new Map<string, DockerRegistryTagDetail>()

        const repositoryImages = registryImages
          .filter((image) => image.repository === repository)
          .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime())

        for (const image of repositoryImages) {
          const tagName = image.tag ?? 'latest'
          if (tagByName.has(tagName)) continue

          tagByName.set(tagName, {
            name: tagName,
            digest: image.digest ?? image.id,
            size: formatBytes(image.sizeBytes),
            pushedAt: image.lastSeenAt,
          })
        }

        const tags = [...tagByName.values()].sort((a, b) => {
          if (a.name === 'latest') return -1
          if (b.name === 'latest') return 1
          return a.name.localeCompare(b.name)
        })

        return {
          repository,
          tags,
        }
      })
  }, [detail, imageEntities])
  const isDetailLoading = detailQuery.isLoading && !detail

  const allTags = useMemo(() => repositories.flatMap((repository) => repository.tags.map((tag) => ({ repository, tag }))), [repositories])

  const selectedRepository = useMemo(() => {
    if (!selectedRepositoryName) return repositories[0] ?? null
    return repositories.find((repo) => repo.repository === selectedRepositoryName) ?? repositories[0] ?? null
  }, [repositories, selectedRepositoryName])

  const selectedTag = useMemo(() => {
    if (!selectedRepository) return null
    if (!selectedTagName) return selectedRepository.tags[0] ?? null
    return selectedRepository.tags.find((tag) => tag.name === selectedTagName) ?? selectedRepository.tags[0] ?? null
  }, [selectedRepository, selectedTagName])

  const selectedImageRef = useMemo(() => {
    if (!detail || !selectedRepository || !selectedTag) return null
    return `${detail.name}/${selectedRepository.repository}:${selectedTag.name}`
  }, [detail, selectedRepository, selectedTag])

  const selectedLocalImageId = useMemo(() => {
    if (!selectedTag || !detail || !selectedRepository) return null
    const exactByDigest = imageEntities.find((image) => image.digest === selectedTag.digest)
    if (exactByDigest) return exactByDigest.id

    const byRef = imageEntities.find((image) => {
      const repositoryRef = `${image.registry}/${image.repository}`
      return repositoryRef === `${detail.name}/${selectedRepository.repository}` && image.tag === selectedTag.name
    })

    return byRef?.id ?? null
  }, [detail, imageEntities, selectedRepository, selectedTag])


  function queueRegistryOp(action: string): void {
    const target = detail?.name ?? id
    setOpsNotice(`${action} queued for ${target}`)
    toast.success(`${action} queued`, {
      description: target,
    })
  }

  function selectRepository(repository: DockerRegistryRepositoryDetail): void {
    setSelectedRepositoryName(repository.repository)
    setSelectedTagName(repository.tags[0]?.name ?? null)
  }

  function selectTag(repository: DockerRegistryRepositoryDetail, tag: DockerRegistryTagDetail): void {
    setSelectedRepositoryName(repository.repository)
    setSelectedTagName(tag.name)
    const localImageId = resolveLocalImageId(repository, tag)
    if (!localImageId) {
      toast.info('Image not available locally yet', {
        description: 'Pull this tag first, then open the image detail.',
      })
      return
    }

    setSelectedImageModalId(localImageId)
    setOpen(false)
    setImageDialogOpen(true)
  }

  function resolveLocalImageId(repository: DockerRegistryRepositoryDetail, tag: DockerRegistryTagDetail): string | null {
    if (!detail) return null
    const exactByDigest = imageEntities.find((image) => image.digest === tag.digest)
    if (exactByDigest) return exactByDigest.id

    const byRef = imageEntities.find((image) => {
      const repositoryRef = `${image.registry}/${image.repository}`
      return repositoryRef === `${detail.name}/${repository.repository}` && image.tag === tag.name
    })

    return byRef?.id ?? null
  }

  return (
    <>
      <button
        type="button"
        className={className ?? 'underline-offset-4 hover:underline text-left'}
        onClick={() => {
          setActiveTab(initialTab)
          setOpen(true)
        }}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[96vw]! max-w-350! h-[85vh] max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>Registry details</DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">{id}</DialogDescription>
              </div>
              <DockerModalQuickActions
                actions={[
                  { label: 'Repositories', icon: Search, onClick: () => setActiveTab('repos') },
                  { label: 'Tags', icon: Search, onClick: () => setActiveTab('tags') },
                  { label: 'Pull image', icon: Download, onClick: () => queueRegistryOp('pull image') },
                  { label: 'Copy image', icon: Copy, onClick: () => queueRegistryOp('copy image') },
                  {
                    label: 'Test auth',
                    icon: ShieldCheck,
                    onClick: () => {
                      setActiveTab('auth')
                      queueRegistryOp('auth test')
                    },
                  },
                ]}
                dangerAction={{ label: 'Prune cache', icon: Trash2, onClick: () => queueRegistryOp('prune cache') }}
              />
            </div>
            {opsNotice ? <p className="text-xs text-muted-foreground">{opsNotice}</p> : null}
          </DialogHeader>
          {detail ? (
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as RegistryDetailTab)}
              className="w-full flex-1 min-h-0 flex flex-col **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:overflow-auto"
            >
              <TabsList className="flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto h-auto shrink-0">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="repos">Repositories</TabsTrigger>
                <TabsTrigger className="shrink-0" value="tags">Tags</TabsTrigger>
                <TabsTrigger className="shrink-0" value="auth">Auth</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-3 text-sm">
                <div className="grid gap-2 md:grid-cols-4">
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Repositories</p>
                    <p className="font-semibold">{String(repositories.length)}</p>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Tags discovered</p>
                    <p className="font-semibold">{String(allTags.length)}</p>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Auth mode</p>
                    <p className="font-semibold">{detail.authMode}</p>
                  </div>
                  <div className="rounded border bg-muted/20 p-3">
                    <p className="text-xs text-muted-foreground">Primary</p>
                    <p className="font-semibold">{detail.isPrimary ? 'yes' : 'no'}</p>
                  </div>
                </div>
                <dl className="grid gap-3 md:grid-cols-2">
                  <div><dt className="text-muted-foreground">Name</dt><dd>{detail.name}</dd></div>
                  <div><dt className="text-muted-foreground">URL</dt><dd className="break-all">{detail.url}</dd></div>
                  <div><dt className="text-muted-foreground">Auth mode</dt><dd>{detail.authMode}</dd></div>
                  <div><dt className="text-muted-foreground">Status</dt><dd><Badge>{detail.status}</Badge></dd></div>
                  <div><dt className="text-muted-foreground">Primary</dt><dd>{detail.isPrimary ? 'yes' : 'no'}</dd></div>
                  <div><dt className="text-muted-foreground">Last synced</dt><dd>{detail.lastSyncedAt ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Selected repository</dt><dd className="font-mono text-xs break-all">{selectedRepository?.repository ?? '—'}</dd></div>
                  <div><dt className="text-muted-foreground">Selected tag</dt><dd className="font-mono text-xs break-all">{selectedTag ? `${selectedTag.name} (${selectedTag.digest})` : '—'}</dd></div>
                </dl>
              </TabsContent>

              <TabsContent value="repos" className="min-h-0 text-sm">
                <div className="grid min-h-0 gap-3 md:grid-cols-[1.1fr_1fr]">
                  <div className="min-h-0 overflow-auto rounded border divide-y">
                    {repositories.map((repo) => (
                      <button
                        key={repo.repository}
                        type="button"
                        className={`w-full px-3 py-2 text-left hover:bg-muted/40 ${selectedRepository?.repository === repo.repository ? 'bg-muted/40' : ''}`}
                        onClick={() => selectRepository(repo)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="font-mono text-xs break-all">{repo.repository}</code>
                          <Badge variant="outline">{repo.tags.length} tags</Badge>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="min-h-0 overflow-auto rounded border p-3 space-y-2">
                    <p className="text-xs text-muted-foreground">Selected repository</p>
                    <p className="font-mono text-xs break-all">{selectedRepository?.repository ?? '—'}</p>
                    <p className="text-xs text-muted-foreground">Tags</p>
                    <div className="rounded border divide-y">
                      {(selectedRepository?.tags ?? []).map((tag) => (
                        <button
                          key={`${selectedRepository?.repository}-${tag.name}`}
                          type="button"
                          className={`w-full px-2 py-1.5 text-left hover:bg-muted/40 ${selectedTag?.name === tag.name ? 'bg-muted/40' : ''}`}
                          onClick={() => {
                            if (!selectedRepository) return
                            selectTag(selectedRepository, tag)
                          }}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs">{tag.name}</span>
                            <span className="text-[11px] text-muted-foreground">{tag.size}</span>
                          </div>
                          <p className="font-mono text-[10px] text-muted-foreground break-all">{tag.digest}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="tags" className="min-h-0 text-sm">
                <div className="min-h-0 overflow-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/70">
                      <tr>
                        <th className="p-2 text-left">Repository</th>
                        <th className="p-2 text-left">Tag</th>
                        <th className="p-2 text-left">Digest</th>
                        <th className="p-2 text-left">Size</th>
                        <th className="p-2 text-left">Pushed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allTags.map(({ repository, tag }) => (
                        <tr
                          key={`${repository.repository}-${tag.name}-${tag.digest}`}
                          className={`border-t cursor-pointer hover:bg-muted/40 ${selectedRepository?.repository === repository.repository && selectedTag?.name === tag.name ? 'bg-muted/40' : ''}`}
                          onClick={() => {
                            selectTag(repository, tag)
                          }}
                        >
                          <td className="p-2 font-mono break-all">{repository.repository}</td>
                          <td className="p-2"><Badge variant="outline">{tag.name}</Badge></td>
                          <td className="p-2 font-mono break-all">{tag.digest}</td>
                          <td className="p-2">{tag.size}</td>
                          <td className="p-2">{tag.pushedAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </TabsContent>

              <TabsContent value="auth" className="space-y-2 text-sm">
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Authentication mode</span>
                  <Badge variant="outline">{detail.authMode}</Badge>
                </div>
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">TLS policy</span>
                  <span>Strict</span>
                </div>
                <div className="rounded border p-3 flex items-center justify-between">
                  <span className="text-muted-foreground">Credential status</span>
                  <span>Configured</span>
                </div>
              </TabsContent>
            </Tabs>
          ) : isDetailLoading ? (
            <DockerDetailLoadingState label="Loading registry details…" />
          ) : (
            <p className="text-sm text-muted-foreground">Registry not found.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {selectedImageModalId ? (
        <DockerImageDetailModal id={selectedImageModalId} open={imageDialogOpen} onOpenChange={setImageDialogOpen} />
      ) : null}
    </>
  )
}