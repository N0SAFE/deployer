import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import { dockerContainerCreateDirectoryContract } from './create-directory'
import { dockerContainerDeletePathContract } from './delete-path'
import { dockerContainerFilesContract } from './list'
import { dockerContainerReadFileContract } from './read'
import { dockerContainerRenamePathContract } from './rename-path'
import { dockerContainerWriteFileContract } from './write'

export const dockerContainerFilesystemContract = oc
    .meta(openapi({ tags: ['Docker Container Filesystem'], prefix: '/files' }))
    .router({
        list: dockerContainerFilesContract,
        read: dockerContainerReadFileContract,
        write: dockerContainerWriteFileContract,
        deletePath: dockerContainerDeletePathContract,
        renamePath: dockerContainerRenamePathContract,
        createDirectory: dockerContainerCreateDirectoryContract,
    })

export {
    dockerContainerFilesContract,
    dockerContainerReadFileContract,
    dockerContainerWriteFileContract,
    dockerContainerDeletePathContract,
    dockerContainerRenamePathContract,
    dockerContainerCreateDirectoryContract,
}
