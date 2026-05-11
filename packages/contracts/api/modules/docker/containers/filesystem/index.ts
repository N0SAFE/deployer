import { oc } from "@orpc/contract";
import { dockerContainerFilesContract } from "./list";
import { dockerContainerReadFileContract } from "./read";
import { dockerContainerWriteFileContract } from "./write";
import { dockerContainerDeletePathContract } from "./delete-path";
import { dockerContainerRenamePathContract } from "./rename-path";
import { dockerContainerCreateDirectoryContract } from "./create-directory";

export const dockerContainerFilesystemContract = oc
  .tag("Docker Container Filesystem")
  .prefix("/files")
  .router({
    list: dockerContainerFilesContract,
    read: dockerContainerReadFileContract,
    write: dockerContainerWriteFileContract,
    deletePath: dockerContainerDeletePathContract,
    renamePath: dockerContainerRenamePathContract,
    createDirectory: dockerContainerCreateDirectoryContract,
  });

export {
  dockerContainerFilesContract,
  dockerContainerReadFileContract,
  dockerContainerWriteFileContract,
  dockerContainerDeletePathContract,
  dockerContainerRenamePathContract,
  dockerContainerCreateDirectoryContract,
};
