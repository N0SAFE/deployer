import type { RefObject } from 'react'
import type { DockerFileEntry } from '@repo/contracts-entities'
import { Button } from '@repo/ui/components/shadcn/button'
import {
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
} from '@repo/ui/components/shadcn/context-menu'
import { Download, Eye, FilePenLine, FolderOpen, FolderPlus, HardDrive, Pencil, Plus, Shield, Terminal, Trash2, Upload } from 'lucide-react'
import { DockerFileBrowser } from '../../docker-file-browser'

interface VolumeMountItem {
  label: string
  path: string
  source: string
  mode: 'ro' | 'rw'
}

interface DockerContainerFilesTabProps {
  fileBrowserMode: 'container' | 'volume'
  volumeMounts: VolumeMountItem[]
  selectedVolumePath: string
  currentFilePath: string
  selectedFilePath: string | null
  selectedFile: DockerFileEntry | null
  selectedFileContent: string
  effectiveFiles: DockerFileEntry[]
  fileActionNotice: string | null
  uploadInputRef: RefObject<HTMLInputElement | null>
  onSetFileBrowserMode: (mode: 'container' | 'volume') => void
  onSetSelectedVolumePath: (path: string) => void
  onSetCurrentFilePath: (path: string) => void
  onSetSelectedFilePath: (path: string | null) => void
  onOpenCreateFolder: () => void
  onTriggerUploadPicker: () => void
  onOpenEditFileModal: () => void
  onUploadFiles: (files: FileList | null) => void
  modeRootPath: string
  onRenameFile: (path: string, type: DockerFileEntry['type']) => void
  onChmodFile: (path: string, type: DockerFileEntry['type']) => void
  onDownloadFile: (path: string) => void
  onDeletePath: (path: string, type: DockerFileEntry['type']) => void
  onGoToTerminalPath: (path: string, type: DockerFileEntry['type']) => void
  onOpenNewTerminalPath: (path: string, type: DockerFileEntry['type']) => void
}

export function DockerContainerFilesTab({
  fileBrowserMode,
  volumeMounts,
  selectedVolumePath,
  currentFilePath,
  selectedFilePath,
  selectedFile,
  selectedFileContent,
  effectiveFiles,
  fileActionNotice,
  uploadInputRef,
  onSetFileBrowserMode,
  onSetSelectedVolumePath,
  onSetCurrentFilePath,
  onSetSelectedFilePath,
  onOpenCreateFolder,
  onTriggerUploadPicker,
  onOpenEditFileModal,
  onUploadFiles,
  modeRootPath,
  onRenameFile,
  onChmodFile,
  onDownloadFile,
  onDeletePath,
  onGoToTerminalPath,
  onOpenNewTerminalPath,
}: DockerContainerFilesTabProps) {
  return (
    <div className="flex min-h-0 flex-col gap-3 text-sm">
      <div className="rounded border p-3 bg-muted/30 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Container file browser (FTP-style navigation)</p>
          <div className="flex items-center gap-1 rounded border bg-background p-0.5">
            <Button
              type="button"
              size="sm"
              variant={fileBrowserMode === 'container' ? 'default' : 'ghost'}
              className="h-7"
              onClick={() => {
                onSetFileBrowserMode('container')
                onSetCurrentFilePath('/')
                onSetSelectedFilePath(null)
              }}
            >
              Container
            </Button>
            <Button
              type="button"
              size="sm"
              variant={fileBrowserMode === 'volume' ? 'default' : 'ghost'}
              className="h-7"
              disabled={volumeMounts.length === 0}
              onClick={() => {
                onSetFileBrowserMode('volume')
                const fallback = volumeMounts[0]?.path ?? '/'
                onSetCurrentFilePath(selectedVolumePath === '/' ? fallback : selectedVolumePath)
                onSetSelectedFilePath(null)
              }}
            >
              <HardDrive className="mr-1 h-3.5 w-3.5" />
              Volumes
            </Button>
          </div>
        </div>

        {fileBrowserMode === 'volume' ? (
          <div className="rounded border bg-background p-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted-foreground">Volume:</span>
              <select
                className="h-8 rounded border bg-background px-2 text-xs"
                value={selectedVolumePath}
                onChange={(event) => {
                  onSetSelectedVolumePath(event.target.value)
                  onSetCurrentFilePath(event.target.value)
                  onSetSelectedFilePath(null)
                }}
              >
                {volumeMounts.map((volume) => (
                  <option key={volume.path} value={volume.path}>
                    {volume.label} ({volume.mode})
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">source: {volumeMounts.find((volume) => volume.path === selectedVolumePath)?.source ?? '—'}</span>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onOpenCreateFolder}>
            <FolderPlus className="mr-1 h-3.5 w-3.5" />
            New folder
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onTriggerUploadPicker}>
            <Upload className="mr-1 h-3.5 w-3.5" />
            Upload files
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={!selectedFile} onClick={onOpenEditFileModal}>
            <FilePenLine className="mr-1 h-3.5 w-3.5" />
            Edit file
          </Button>
          <input
            ref={uploadInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              onUploadFiles(event.target.files)
              event.currentTarget.value = ''
            }}
          />

          <p className="text-xs text-muted-foreground">Tip: right-click any file/folder row for quick actions.</p>
        </div>
      </div>

      <DockerFileBrowser
        files={effectiveFiles}
        currentPath={currentFilePath}
        selectedFilePath={selectedFilePath}
        modeRootPath={modeRootPath}
        notice={fileActionNotice}
        onCurrentPathChange={onSetCurrentFilePath}
        onSelectedFilePathChange={onSetSelectedFilePath}
        onDropUploadFiles={(files) => {
          onUploadFiles(files)
        }}
        getFilePreviewContent={(file) => {
          if (selectedFile?.path === file.path) return selectedFileContent
          return `Select ${file.path} to load its content`
        }}
        renderRowActions={(entry) => (
          <>
            <button
              type="button"
              title="Rename"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                onRenameFile(entry.path, entry.type)
              }}
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              title="Change permission"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation()
                onChmodFile(entry.path, entry.type)
              }}
            >
              <Shield className="h-3 w-3" />
            </button>
            {entry.type === 'file' ? (
              <button
                type="button"
                title="Download"
                className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation()
                  onDownloadFile(entry.path)
                }}
              >
                <Download className="h-3 w-3" />
              </button>
            ) : null}
            <button
              type="button"
              title="Delete"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-destructive transition-colors hover:bg-destructive/10"
              onClick={(event) => {
                event.stopPropagation()
                onDeletePath(entry.path, entry.type)
              }}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </button>
          </>
        )}
        renderRowContextMenu={(entry) => (
          <>
            <ContextMenuLabel>{entry.name}</ContextMenuLabel>
            <ContextMenuSeparator />

            {entry.type === 'dir' ? (
              <ContextMenuItem
                onSelect={() => {
                  onSetCurrentFilePath(entry.path)
                  onSetSelectedFilePath(null)
                }}
              >
                <FolderOpen className="mr-2 h-4 w-4" />
                Open folder
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                onSelect={() => {
                  onSetSelectedFilePath(entry.path)
                }}
              >
                <Eye className="mr-2 h-4 w-4" />
                Preview file
              </ContextMenuItem>
            )}

            <ContextMenuSeparator />

            <ContextMenuItem
              onSelect={() => {
                onGoToTerminalPath(entry.path, entry.type)
              }}
            >
              <Terminal className="mr-2 h-4 w-4" />
              Go to terminal here
            </ContextMenuItem>

            <ContextMenuItem
              onSelect={() => {
                onOpenNewTerminalPath(entry.path, entry.type)
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Open new terminal here
            </ContextMenuItem>

            <ContextMenuSeparator />

            <ContextMenuItem
              onSelect={() => {
                onRenameFile(entry.path, entry.type)
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Rename
            </ContextMenuItem>

            <ContextMenuItem
              onSelect={() => {
                onChmodFile(entry.path, entry.type)
              }}
            >
              <Shield className="mr-2 h-4 w-4" />
              Change permission
            </ContextMenuItem>

            {entry.type === 'file' ? (
              <ContextMenuItem
                onSelect={() => {
                  onDownloadFile(entry.path)
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Download
              </ContextMenuItem>
            ) : null}

            <ContextMenuSeparator />

            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                onDeletePath(entry.path, entry.type)
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </ContextMenuItem>
          </>
        )}
      />
    </div>
  )
}