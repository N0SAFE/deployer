'use client'

import { Fragment, type ReactNode, useMemo, useState } from 'react'
import type { DockerFileEntry } from '@/mocks/platform/types'
import { Badge } from '@repo/ui/components/shadcn/badge'
import { Button } from '@repo/ui/components/shadcn/button'
import { FolderOpen, Maximize2, Minimize2, X } from 'lucide-react'
import { getFilesInDirectory, getPathBreadcrumb, getParentPath } from './docker-filesystem-utils'

interface DockerFileBrowserProps {
  files: DockerFileEntry[]
  currentPath: string
  selectedFilePath: string | null
  modeRootPath?: string
  notice?: string | null
  emptyMessage?: string
  onCurrentPathChange: (path: string) => void
  onSelectedFilePathChange: (path: string | null) => void
  getFilePreviewContent: (file: DockerFileEntry) => string
  renderRowActions?: (entry: { path: string; type: DockerFileEntry['type'] }) => ReactNode
  onDropUploadFiles?: (files: FileList) => void
}

export function DockerFileBrowser({
  files,
  currentPath,
  selectedFilePath,
  modeRootPath = '/',
  notice,
  emptyMessage = 'This directory is empty.',
  onCurrentPathChange,
  onSelectedFilePathChange,
  getFilePreviewContent,
  renderRowActions,
  onDropUploadFiles,
}: DockerFileBrowserProps) {
  const [isPreviewOpen, setIsPreviewOpen] = useState(true)
  const [isPreviewFullTab, setIsPreviewFullTab] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const filesInCurrentDirectory = useMemo(() => getFilesInDirectory(currentPath, files), [currentPath, files])
  const filePathBreadcrumb = useMemo(() => getPathBreadcrumb(currentPath), [currentPath])
  const selectedFile = useMemo(() => {
    if (!selectedFilePath) return null
    return files.find((entry) => entry.path === selectedFilePath && entry.type === 'file') ?? null
  }, [files, selectedFilePath])

  return (
    <div className="flex-1 min-h-0 rounded border overflow-hidden">
      <div
        className={`h-full min-h-0 grid grid-cols-1 ${isPreviewOpen && !isPreviewFullTab ? 'lg:grid-cols-[1.15fr_1fr]' : ''}`}
        onDragOver={(event) => {
          if (!onDropUploadFiles) return
          event.preventDefault()
          if (!dragActive) setDragActive(true)
        }}
        onDragLeave={(event) => {
          if (!onDropUploadFiles) return
          event.preventDefault()
          if (event.currentTarget.contains(event.relatedTarget as Node)) return
          setDragActive(false)
        }}
        onDrop={(event) => {
          if (!onDropUploadFiles) return
          event.preventDefault()
          setDragActive(false)
          onDropUploadFiles(event.dataTransfer.files)
        }}
      >
        {!isPreviewFullTab ? (
          <div className="min-h-0 overflow-auto divide-y relative">
            {dragActive ? (
              <div className="absolute inset-2 z-20 rounded border-2 border-dashed border-primary/50 bg-primary/10 flex items-center justify-center pointer-events-none">
                <p className="text-sm font-medium text-primary">Drop files here to upload</p>
              </div>
            ) : null}
            <div className="sticky top-0 z-10 border-b bg-background/95 px-3 py-2">
              <p className="text-xs text-muted-foreground">Full path</p>
              <p className="font-mono text-xs break-all">{currentPath}</p>
              {notice ? <p className="mt-1 text-[11px] text-muted-foreground">{notice}</p> : null}
            </div>

            <div className="border-b px-3 py-2">
              <div className="flex items-center gap-1 text-xs min-w-0 overflow-x-auto">
                {filePathBreadcrumb.map((crumb, index) => {
                  const isLast = index === filePathBreadcrumb.length - 1
                  const targetPath = crumb === '/'
                    ? '/'
                    : `/${filePathBreadcrumb.slice(1, index + 1).join('/')}`
                  return (
                    <Fragment key={`${crumb}-${String(index)}`}>
                      <button
                        type="button"
                        className={`font-mono ${isLast ? 'text-foreground' : 'text-muted-foreground hover:text-foreground underline-offset-4 hover:underline'}`}
                        onClick={() => {
                          if (!targetPath.startsWith(modeRootPath)) return
                          onCurrentPathChange(targetPath)
                          onSelectedFilePathChange(null)
                        }}
                        disabled={isLast}
                      >
                        {crumb}
                      </button>
                      {!isLast ? <span className="text-muted-foreground">/</span> : null}
                    </Fragment>
                  )
                })}
              </div>
            </div>

            {currentPath !== '/' ? (
              <button
                type="button"
                className="w-full text-left px-3 py-2 hover:bg-muted/40 text-xs font-mono"
                onClick={() => {
                  const candidate = getParentPath(currentPath)
                  const clampedPath = !candidate.startsWith(modeRootPath)
                    ? modeRootPath
                    : candidate
                  onCurrentPathChange(clampedPath)
                  onSelectedFilePathChange(null)
                }}
              >
                ..
              </button>
            ) : null}

            {filesInCurrentDirectory.map((entry) => (
              <div
                key={entry.path}
                className={`px-3 py-2 hover:bg-muted/40 grid grid-cols-[auto_1fr_auto_auto] items-center gap-2 cursor-pointer ${selectedFilePath === entry.path ? 'bg-muted/30' : ''}`}
                onClick={() => {
                  if (entry.type === 'dir') {
                    onCurrentPathChange(entry.path)
                    onSelectedFilePathChange(null)
                    return
                  }
                  onSelectedFilePathChange(entry.path)
                  setIsPreviewOpen(true)
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  if (entry.type === 'dir') {
                    onCurrentPathChange(entry.path)
                    onSelectedFilePathChange(null)
                    return
                  }
                  onSelectedFilePathChange(entry.path)
                  setIsPreviewOpen(true)
                }}
              >
                <span className="text-sm" aria-hidden="true">
                  {entry.type === 'dir' ? <FolderOpen className="h-4 w-4 text-muted-foreground" /> : '📄'}
                </span>
                <span className="font-mono text-xs break-all text-left">{entry.name}</span>
                <Badge variant="outline" className="justify-self-end">{entry.type}</Badge>
                <div className="flex items-center justify-end gap-1">
                  {renderRowActions ? renderRowActions({ path: entry.path, type: entry.type }) : null}
                </div>
              </div>
            ))}

            {filesInCurrentDirectory.length === 0 ? (
              <p className="px-3 py-6 text-xs text-muted-foreground">{emptyMessage}</p>
            ) : null}
          </div>
        ) : null}

        {isPreviewOpen ? (
          <div className={`min-h-0 flex flex-col ${isPreviewFullTab ? '' : 'border-t lg:border-t-0 lg:border-l'}`}>
            <div className="px-3 py-2 border-b bg-muted/20 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Preview</p>
                <p className="font-mono text-xs break-all">
                  {selectedFile ? selectedFile.path : 'Select a file to preview its content'}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  title={isPreviewFullTab ? 'Exit full tab preview' : 'Open preview in full tab'}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => {
                    setIsPreviewFullTab((previous) => !previous)
                  }}
                  disabled={!selectedFile}
                >
                  {isPreviewFullTab ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  title="Close preview"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => {
                    setIsPreviewOpen(false)
                    setIsPreviewFullTab(false)
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-auto p-3">
              {selectedFile ? (
                <pre className="text-xs font-mono whitespace-pre-wrap wrap-break-word">{getFilePreviewContent(selectedFile)}</pre>
              ) : (
                <p className="text-xs text-muted-foreground">Choose any file from the directory pane.</p>
              )}
            </div>
          </div>
        ) : (
          <div className="hidden lg:flex lg:items-center lg:justify-center lg:border-l">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setIsPreviewOpen(true)
              }}
            >
              Open preview panel
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}