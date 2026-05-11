'use client'

import { type ReactNode, useMemo, useState } from 'react'
import { useDockerRuntimeEntityDetail } from '@/domains/docker/hooks'
import { getMockVolumeFiles } from '@/mocks/platform/entities/docker.large.mock'
import type { DockerFileEntry } from '@/mocks/platform/types'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@repo/ui/components/shadcn/tabs'
import { HardDrive, ShieldCheck, Trash2 } from 'lucide-react'
import { DockerFileBrowser } from './docker-file-browser'
import { DockerKeyValueGrid } from './docker-key-value-grid'
import { DockerDetailLoadingState } from './docker-loading-states'
import { DockerModalQuickActions } from './docker-modal-quick-actions'
import { toast } from 'sonner'

interface DockerVolumeDetailModalTriggerProps {
  id: string
  children: ReactNode
  className?: string
  initialTab?: 'overview' | 'usage' | 'files' | 'labels'
}

export function DockerVolumeDetailModalTrigger({ id, children, className, initialTab = 'overview' }: DockerVolumeDetailModalTriggerProps) {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'overview' | 'usage' | 'files' | 'labels'>(initialTab)
  const [currentPath, setCurrentPath] = useState('/')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [maintenanceNotice, setMaintenanceNotice] = useState<string | null>(null)
  const detailQuery = useDockerRuntimeEntityDetail('volumes', id, { enabled: open })
  const detail = detailQuery.data
  const files = useMemo(() => getMockVolumeFiles(id), [id])
  const isDetailLoading = detailQuery.isLoading && !detail

  const selectedFile = useMemo(() => {
    if (!selectedFilePath) return null
    return files.find((entry) => entry.path === selectedFilePath && entry.type === 'file') ?? null
  }, [files, selectedFilePath])

  const selectedFilePreview = useMemo(() => {
    if (!selectedFile) return ''
    const name = selectedFile.path.split('/').pop() ?? selectedFile.path
    if (name.endsWith('.json')) {
      return JSON.stringify(
        {
          volumeId: id,
          file: selectedFile.path,
          generatedAt: new Date().toISOString(),
          volumeName: detail?.name ?? 'unknown',
        },
        null,
        2,
      )
    }
    if (name.endsWith('.env')) {
      return [
        `VOLUME_ID=${id}`,
        `VOLUME_NAME=${detail?.name ?? 'unknown'}`,
        `VOLUME_DRIVER=${detail?.driver ?? 'local'}`,
      ].join('\n')
    }

    return [
      `# ${name}`,
      '',
      `Path: ${selectedFile.path}`,
      `Owner: ${selectedFile.owner}`,
      `Permissions: ${selectedFile.permissions}`,
      `Updated: ${selectedFile.updatedAt}`,
    ].join('\n')
  }, [detail?.driver, detail?.name, id, selectedFile])

  function queueMaintenance(action: 'backup' | 'restore' | 'clone' | 'prune'): void {
    const target = detail?.name ?? id
    const message = `${action} queued for ${target}`
    setMaintenanceNotice(message)
    toast.success(`${action} queued`, {
      description: target,
    })
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
                <DialogTitle>Volume details</DialogTitle>
                <DialogDescription className="font-mono text-xs break-all">{id}</DialogDescription>
              </div>
              <DockerModalQuickActions
                actions={[
                  { label: 'Browse', icon: HardDrive, onClick: () => setActiveTab('files') },
                  { label: 'Usage', icon: ShieldCheck, onClick: () => setActiveTab('usage') },
                  { label: 'Labels', icon: ShieldCheck, onClick: () => setActiveTab('labels') },
                  { label: 'Backup', icon: ShieldCheck, onClick: () => queueMaintenance('backup') },
                  { label: 'Restore', icon: ShieldCheck, onClick: () => queueMaintenance('restore') },
                  { label: 'Clone', icon: ShieldCheck, onClick: () => queueMaintenance('clone') },
                ]}
                dangerAction={{ label: 'Prune', icon: Trash2, onClick: () => queueMaintenance('prune') }}
              />
            </div>
            {maintenanceNotice ? <p className="text-xs text-muted-foreground">{maintenanceNotice}</p> : null}
          </DialogHeader>
          {detail ? (
            <Tabs
              value={activeTab}
              onValueChange={(value) => setActiveTab(value as 'overview' | 'usage' | 'files' | 'labels')}
              className="w-full flex-1 min-h-0 flex flex-col **:[[role=tabpanel]]:flex-1 **:[[role=tabpanel]]:min-h-0 **:[[role=tabpanel]]:overflow-auto"
            >
              <TabsList className="flex w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto h-auto shrink-0">
                <TabsTrigger className="shrink-0" value="overview">Overview</TabsTrigger>
                <TabsTrigger className="shrink-0" value="usage">Usage</TabsTrigger>
                <TabsTrigger className="shrink-0" value="files">Files</TabsTrigger>
                <TabsTrigger className="shrink-0" value="labels">Labels</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="text-sm">
                <DockerKeyValueGrid
                  items={[
                    { key: 'Name', value: detail.name },
                    { key: 'Driver', value: detail.driver },
                    { key: 'Mountpoint', value: detail.mountpoint ?? '—' },
                    { key: 'Size', value: detail.sizeBytes === null ? '—' : `${detail.sizeBytes} bytes` },
                    { key: 'Attached containers', value: String(detail.usedByContainerIds.length) },
                    { key: 'Updated', value: detail.updatedAt },
                  ]}
                />
              </TabsContent>

              <TabsContent value="usage" className="space-y-2 text-sm">
                {detail.usedByContainerIds.length > 0 ? detail.usedByContainerIds.map((containerId) => (
                  <div key={containerId} className="rounded border p-3 flex items-center justify-between">
                    <code className="font-mono text-xs break-all">{containerId}</code>
                    <Badge variant="outline">mounted</Badge>
                  </div>
                )) : <p className="text-muted-foreground">No containers currently attached.</p>}
              </TabsContent>

              <TabsContent value="files" className="space-y-2 text-sm">
                <DockerFileBrowser
                  files={files}
                  currentPath={currentPath}
                  selectedFilePath={selectedFilePath}
                  notice={`Volume root: ${detail.mountpoint ?? '/'}`}
                  onCurrentPathChange={setCurrentPath}
                  onSelectedFilePathChange={setSelectedFilePath}
                  getFilePreviewContent={(file: DockerFileEntry) => {
                    if (selectedFile?.path === file.path) return selectedFilePreview
                    const name = file.path.split('/').pop() ?? file.path
                    return [
                      `# ${name}`,
                      '',
                      `Path: ${file.path}`,
                      `Owner: ${file.owner}`,
                      `Permissions: ${file.permissions}`,
                      `Updated: ${file.updatedAt}`,
                    ].join('\n')
                  }}
                />
              </TabsContent>

              <TabsContent value="labels" className="space-y-2 text-sm">
                {Object.entries(detail.labels).length > 0 ? Object.entries(detail.labels).map(([key, value]) => (
                  <div key={key} className="rounded border p-3 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{key}</span>
                    <code className="text-xs font-mono break-all">{value}</code>
                  </div>
                )) : <p className="text-muted-foreground">No labels on this volume.</p>}
              </TabsContent>
            </Tabs>
          ) : isDetailLoading ? (
            <DockerDetailLoadingState label="Loading volume details…" />
          ) : (
            <p className="text-sm text-muted-foreground">Volume not found.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}