'use client'

import { useMemo, useRef, useState } from 'react'
import {
  useDockerContainerFiles,
  useDockerContainerReadFile,
  useDockerCreateContainerDirectory,
  useDockerDeleteContainerPath,
  useDockerRenameContainerPath,
  useDockerWriteContainerFile,
} from '@/domains/docker/hooks'
import { getErrorMessage, isDefinedORPCError } from '@/lib/orpc/typed-errors'
import type { DockerContainerInspectDetail, DockerFileEntry } from '@deployer/contracts-entities'
import { getEntryName, getParentPath, toSafePathName } from '../_components/docker-filesystem-utils'
import { joinContainerPath } from '../_utils/container-detail'
import { useOnDepsChange } from './use-on-deps-change'

type FileType = DockerFileEntry['type']

interface UseContainerFilesParams {
  id: string
  active: boolean
  inspectDetail: DockerContainerInspectDetail | null
}

function describeError(error: unknown): string {
  return isDefinedORPCError(error) ? getErrorMessage(error) : String(error)
}

/** Replaces `from` by `to` in `previous` when it is that path (or, for directories, lives under it). */
function remapPath(previous: string, from: string, to: string, type: FileType): string {
  if (previous === from) return to
  if (type === 'dir' && previous.startsWith(`${from}/`)) return `${to}${previous.slice(from.length)}`
  return previous
}

/**
 * Everything the Files tab needs: directory listing, selected file, volume vs
 * container browsing, and the rename / create-folder / edit / delete flows.
 */
export function useContainerFiles({ id, active, inspectDetail }: UseContainerFilesParams) {
  const [currentFilePath, setCurrentFilePath] = useState('/')
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null)
  const [fileActionNotice, setFileActionNotice] = useState<string | null>(null)
  const [fileBrowserMode, setFileBrowserMode] = useState<'container' | 'volume'>('container')
  const [selectedVolumePath, setSelectedVolumePath] = useState('/')
  const [renameTarget, setRenameTarget] = useState<{ path: string; type: FileType } | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [isCreateFolderOpen, setIsCreateFolderOpen] = useState(false)
  const [isEditFileOpen, setIsEditFileOpen] = useState(false)
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null)
  const [editingFileContent, setEditingFileContent] = useState('')
  const [pendingDelete, setPendingDelete] = useState<{ path: string; type: FileType } | null>(null)
  const [filesState, setFilesState] = useState<DockerFileEntry[]>([])
  const uploadInputRef = useRef<HTMLInputElement | null>(null)

  const filesQuery = useDockerContainerFiles(
    { query: { containerId: id, path: currentFilePath } },
    { enabled: active },
  )
  const selectedFileQuery = useDockerContainerReadFile(
    { query: { containerId: id, path: selectedFilePath ?? '/' } },
    { enabled: active && selectedFilePath !== null },
  )
  const writeFileMutation = useDockerWriteContainerFile()
  const deletePathMutation = useDockerDeleteContainerPath()
  const renamePathMutation = useDockerRenameContainerPath()
  const createDirectoryMutation = useDockerCreateContainerDirectory()

  const volumeMounts = useMemo<{ label: string; path: string; source: string; mode: 'ro' | 'rw' }[]>(() => {
    const mounts = inspectDetail?.mounts ?? []
    return mounts
      .filter((mount) => mount.type === 'volume')
      .map((mount) => ({
        label: mount.target,
        path: mount.target,
        source: mount.source,
        mode: mount.readOnly ? 'ro' : 'rw',
      }))
  }, [inspectDetail?.mounts])

  const effectiveFiles = useMemo(() => {
    if (fileBrowserMode === 'container') return filesState
    const root = selectedVolumePath.replace(/\/$/, '') || '/'
    return filesState.filter((entry) => entry.path === root || entry.path.startsWith(`${root}/`))
  }, [fileBrowserMode, filesState, selectedVolumePath])

  const selectedFile = useMemo(() => {
    if (!selectedFilePath) return null
    return effectiveFiles.find((entry) => entry.path === selectedFilePath && entry.type === 'file') ?? null
  }, [effectiveFiles, selectedFilePath])

  const selectedFileContent = selectedFile ? (selectedFileQuery.data?.content ?? '') : ''

  const refetchFiles = () => { void filesQuery.refetch() }

  function download(path: string): void {
    const content = selectedFileQuery.data?.content
    if (!content) {
      setFileActionNotice(`No file content available for ${path}`)
      return
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = path.split('/').pop() ?? 'container-file.txt'
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(href)
    setFileActionNotice(`Downloaded ${path}`)
  }

  /** Asks for confirmation; the delete itself runs in `confirmDelete`. */
  function requestDelete(path: string, type: FileType): void {
    setPendingDelete({ path, type })
  }

  function confirmDelete(): void {
    if (!pendingDelete) return
    const { path } = pendingDelete
    deletePathMutation.mutate(
      { containerId: id, path },
      {
        onSuccess: () => {
          setSelectedFilePath((previous) => (previous && (previous === path || previous.startsWith(`${path}/`)) ? null : previous))
          setCurrentFilePath((previous) => (previous === path || previous.startsWith(`${path}/`) ? getParentPath(path) : previous))
          setFileActionNotice(`Deleted ${path}`)
          setPendingDelete(null)
          refetchFiles()
        },
        onError: (error) => {
          setFileActionNotice(`Delete failed: ${describeError(error)}`)
          setPendingDelete(null)
        },
      },
    )
  }

  function startRename(path: string, type: FileType): void {
    setRenameTarget({ path, type })
    setRenameInput(getEntryName(path))
  }

  function cancelRename(): void {
    setRenameTarget(null)
    setRenameInput('')
  }

  function confirmRename(): void {
    if (!renameTarget) return
    const currentName = getEntryName(renameTarget.path)
    const nextName = renameInput.trim()
    if (!nextName || nextName === currentName) {
      cancelRename()
      return
    }

    const { path: currentPath, type } = renameTarget
    const parentPath = getParentPath(currentPath)
    const nextPath = parentPath === '/' ? `/${nextName}` : `${parentPath}/${nextName}`

    renamePathMutation.mutate(
      { containerId: id, path: currentPath, nextPath },
      {
        onSuccess: () => {
          setSelectedFilePath((previous) => (previous ? remapPath(previous, currentPath, nextPath, type) : previous))
          setCurrentFilePath((previous) => remapPath(previous, currentPath, nextPath, type))
          setFileActionNotice(`Renamed ${currentName} to ${nextName}`)
          cancelRename()
          refetchFiles()
        },
        onError: (error) => {
          setFileActionNotice(`Rename failed: ${describeError(error)}`)
        },
      },
    )
  }

  function chmod(path: string): void {
    setFileActionNotice(`chmod is not available yet for ${path}`)
  }

  function cancelCreateFolder(): void {
    setIsCreateFolderOpen(false)
    setNewFolderName('')
  }

  function createFolder(): void {
    const safeFolderName = toSafePathName(newFolderName)
    if (!safeFolderName) return

    const nextPath = joinContainerPath(currentFilePath, safeFolderName)
    if (filesState.some((entry) => entry.path === nextPath)) {
      setFileActionNotice(`Cannot create ${safeFolderName}: already exists`)
      return
    }

    createDirectoryMutation.mutate(
      { containerId: id, path: nextPath },
      {
        onSuccess: () => {
          setFileActionNotice(`Folder created: ${nextPath}`)
          cancelCreateFolder()
          refetchFiles()
        },
        onError: (error) => {
          setFileActionNotice(`Create folder failed: ${describeError(error)}`)
        },
      },
    )
  }

  function openEditor(): void {
    if (!selectedFile) return
    setEditingFilePath(selectedFile.path)
    setEditingFileContent(selectedFileContent)
    setIsEditFileOpen(true)
  }

  function closeEditor(): void {
    setIsEditFileOpen(false)
    setEditingFilePath(null)
  }

  function saveEditedFile(): void {
    if (!editingFilePath) return
    writeFileMutation.mutate(
      { containerId: id, path: editingFilePath, content: editingFileContent, createParents: true },
      {
        onSuccess: () => {
          setFileActionNotice(`Saved ${editingFilePath}`)
          closeEditor()
          void selectedFileQuery.refetch()
          refetchFiles()
        },
        onError: (error) => {
          setFileActionNotice(`Save failed: ${describeError(error)}`)
        },
      },
    )
  }

  function uploadFiles(files: FileList | null): void {
    if (!files || files.length === 0) return
    const validFiles = Array.from(files).filter((file) => file.name.trim().length > 0)
    if (validFiles.length === 0) return

    void Promise.all(
      validFiles.map(async (file) => {
        const basePath = currentFilePath === '/' ? '' : currentFilePath.replace(/\/$/, '')
        const targetPath = `${basePath}/${file.name.replace(/\//g, '-')}`
        const content = await file.text()
        return writeFileMutation.mutateAsync({ containerId: id, path: targetPath, content, createParents: true })
      }),
    )
      .then(() => {
        setFileActionNotice(`Uploaded ${String(validFiles.length)} file${validFiles.length > 1 ? 's' : ''} to ${currentFilePath}`)
        refetchFiles()
      })
      .catch((error: unknown) => {
        setFileActionNotice(`Upload failed: ${describeError(error)}`)
      })
  }

  useOnDepsChange([filesQuery.data], () => {
    if (filesQuery.data) setFilesState(filesQuery.data.entries)
  })

  useOnDepsChange([fileBrowserMode, selectedVolumePath, volumeMounts], () => {
    if (volumeMounts.length === 0) {
      if (fileBrowserMode === 'volume') setFileBrowserMode('container')
      return
    }
    if (selectedVolumePath === '/' || !volumeMounts.some((volume) => volume.path === selectedVolumePath)) {
      setSelectedVolumePath(volumeMounts[0]?.path ?? '/')
    }
  })

  useOnDepsChange([currentFilePath, fileBrowserMode, selectedVolumePath], () => {
    if (fileBrowserMode === 'container') return
    const nextRoot = selectedVolumePath || '/'
    if (currentFilePath === '/' || !currentFilePath.startsWith(nextRoot)) {
      setCurrentFilePath(nextRoot)
      setSelectedFilePath(null)
    }
  })

  useOnDepsChange([id], () => {
    setCurrentFilePath('/')
    setSelectedFilePath(null)
    setFileActionNotice(null)
    setFileBrowserMode('container')
    setSelectedVolumePath('/')
    setRenameTarget(null)
    setRenameInput('')
    setNewFolderName('')
    setIsCreateFolderOpen(false)
    setIsEditFileOpen(false)
    setEditingFilePath(null)
    setEditingFileContent('')
    setPendingDelete(null)
  }, false)

  return {
    // browser state
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
    modeRootPath: fileBrowserMode === 'volume' ? selectedVolumePath : '/',
    listError: filesQuery.error,
    isListLoading: filesQuery.isLoading,
    refetchList: filesQuery.refetch,
    setFileBrowserMode,
    setSelectedVolumePath,
    setCurrentFilePath,
    setSelectedFilePath,
    // actions
    download,
    chmod,
    uploadFiles,
    openCreateFolder: () => { setIsCreateFolderOpen(true) },
    openEditor,
    // delete flow
    pendingDelete,
    isDeleting: deletePathMutation.isPending,
    requestDelete,
    confirmDelete,
    cancelDelete: () => { setPendingDelete(null) },
    // rename dialog
    renameTarget,
    renameInput,
    setRenameInput,
    startRename,
    confirmRename,
    cancelRename,
    // create-folder dialog
    isCreateFolderOpen,
    newFolderName,
    setNewFolderName,
    createFolder,
    cancelCreateFolder,
    // edit dialog
    isEditFileOpen,
    editingFilePath,
    editingFileContent,
    setEditingFileContent,
    saveEditedFile,
    closeEditor,
  }
}
