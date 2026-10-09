'use client'

import { Button } from '@repo/ui/components/shadcn/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@repo/ui/components/shadcn/dialog'
import { DockerConfirmDialog } from '../docker-confirm-dialog'
import type { useContainerFiles } from '../../_hooks/use-container-files'

type FilesModel = ReturnType<typeof useContainerFiles>

const INPUT_CLASS = 'w-full rounded border bg-background px-3 py-2 text-sm'

/** Rename, create-folder, edit-file dialogs and the delete confirmation for the Files tab. */
export function ContainerFileDialogs({ files, containerName }: { files: FilesModel; containerName: string }) {
  const { renameTarget, pendingDelete } = files
  const deleteKind = pendingDelete?.type === 'dir' ? 'folder' : 'file'

  return (
    <>
      <Dialog open={renameTarget !== null} onOpenChange={(next: boolean) => { if (!next) files.cancelRename() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename {renameTarget?.type === 'dir' ? 'folder' : 'file'}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{renameTarget?.path}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="file-rename-input">New name</label>
            <input
              id="file-rename-input"
              type="text"
              value={files.renameInput}
              autoFocus
              className={INPUT_CLASS}
              onChange={(event) => { files.setRenameInput(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  files.confirmRename()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={files.cancelRename}>Cancel</Button>
            <Button type="button" onClick={files.confirmRename}>Rename {renameTarget?.type === 'dir' ? 'folder' : 'file'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={files.isCreateFolderOpen} onOpenChange={(next: boolean) => { if (!next) files.cancelCreateFolder() }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create folder</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">Location: {files.currentFilePath}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground" htmlFor="new-folder-input">Folder name</label>
            <input
              id="new-folder-input"
              type="text"
              value={files.newFolderName}
              autoFocus
              className={INPUT_CLASS}
              placeholder="e.g. config"
              onChange={(event) => { files.setNewFolderName(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  files.createFolder()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={files.cancelCreateFolder}>Cancel</Button>
            <Button type="button" onClick={files.createFolder}>Create folder</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={files.isEditFileOpen} onOpenChange={(next: boolean) => { if (!next) files.closeEditor() }}>
        <DialogContent className="flex h-[70vh] w-[92vw] max-w-4xl flex-col">
          <DialogHeader>
            <DialogTitle>Edit file</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">
              {files.editingFilePath ?? files.selectedFile?.path ?? 'No file selected'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <textarea
              aria-label="File content"
              className="h-full w-full resize-none rounded border bg-background p-3 font-mono text-xs"
              value={files.editingFileContent}
              onChange={(event) => { files.setEditingFileContent(event.target.value) }}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={files.closeEditor}>Cancel</Button>
            <Button type="button" onClick={files.saveEditedFile}>Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DockerConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => { if (!next) files.cancelDelete() }}
        title={`Delete ${deleteKind}?`}
        objectName={pendingDelete?.path ?? ''}
        consequence={
          <>
            this {deleteKind}{pendingDelete?.type === 'dir' ? ' and everything inside it' : ''} will be removed from the
            running container {containerName} and cannot be recovered.
          </>
        }
        confirmLabel={`Delete ${deleteKind}`}
        pending={files.isDeleting}
        onConfirm={files.confirmDelete}
      />
    </>
  )
}
