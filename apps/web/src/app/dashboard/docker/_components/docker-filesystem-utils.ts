'use client'

import type { DockerFileEntry } from '@repo/contracts-entities'

export interface DockerDirectoryEntryView {
  name: string
  path: string
  type: DockerFileEntry['type']
  entry?: DockerFileEntry
}

export function getEntryName(path: string): string {
  const parts = path.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function getParentPath(path: string): string {
  const parts = path.split('/').filter(Boolean).slice(0, -1)
  return parts.length > 0 ? `/${parts.join('/')}` : '/'
}

export function toSafePathName(value: string): string {
  return value.trim().replace(/\/+/g, '-').replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 64)
}

export function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes <= 0) return '0 B'
  if (sizeInBytes < 1024) return `${String(sizeInBytes)} B`
  if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`
  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getPathBreadcrumb(path: string): string[] {
  if (path === '/') return ['/']
  const parts = path.split('/').filter(Boolean)
  return ['/', ...parts]
}

export function getFilesInDirectory(currentFilePath: string, files: DockerFileEntry[]): DockerDirectoryEntryView[] {
  const current = currentFilePath === '/' ? '/' : currentFilePath.replace(/\/$/, '')
  const index = new Map<string, DockerDirectoryEntryView>()

  for (const entry of files) {
    const path = entry.path
    if (!path.startsWith('/')) continue
    if (path === current) continue

    const rest = current === '/'
      ? path.slice(1)
      : path.startsWith(`${current}/`)
        ? path.slice(current.length + 1)
        : null

    if (!rest) continue
    const [segment, ...tail] = rest.split('/')
    if (!segment) continue

    const isDir = entry.type === 'dir' || tail.length > 0
    const childPath = current === '/' ? `/${segment}` : `${current}/${segment}`
    const existing = index.get(segment)

    if (!existing) {
      index.set(segment, {
        name: segment,
        path: childPath,
        type: isDir ? 'dir' : 'file',
        entry: isDir ? undefined : entry,
      })
      continue
    }

    if (existing.type === 'file' && isDir) {
      index.set(segment, {
        ...existing,
        path: childPath,
        type: 'dir',
        entry: undefined,
      })
    }
  }

  return Array.from(index.values()).sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}