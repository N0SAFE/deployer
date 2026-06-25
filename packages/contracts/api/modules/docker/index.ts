import { oc } from "@orpc/contract";

import {
  dockerContainersContract,
  dockerContainerCreateDirectoryContract,
  dockerContainerDeletePathContract,
  dockerContainerFilesContract,
  dockerListContainersContract,
  dockerListContainersGroupedContract,
  dockerContainerLogsStreamContract,
  dockerContainerLinkedListContract,
  dockerContainerProcessLogsStreamContract,
  dockerContainerProcessesContract,
  dockerContainerProcessesStreamContract,
  dockerContainerReadFileContract,
  dockerContainerRenamePathContract,
  dockerContainerInspectContract,
  dockerContainerRuntimeActionContract,
  dockerContainerInspectStreamContract,
  dockerContainerTerminalCloseContract,
  dockerContainerTerminalInputContract,
  dockerContainerTerminalOpenContract,
  dockerContainerTerminalStreamContract,
  dockerContainerWriteFileContract,
} from "./containers";
import {
  dockerImagesContract,
  dockerImageInspectContract,
  dockerImageSecurityScanStreamContract,
  dockerImageInspectStreamContract,
  dockerListImagesContract,
} from "./images";
import { dockerNetworksContract, dockerListNetworksContract } from "./networks";
import { dockerVolumesContract, dockerListVolumesContract } from "./volumes";
import { dockerRegistriesContract, dockerListRegistriesContract } from "./registries";
import { dockerStacksContract, dockerListStacksContract } from "./stacks";
import {
  dockerRuntimeContract,
  dockerRuntimeEventsStreamContract,
  dockerRuntimeSnapshotContract,
} from "./runtime";
import { dockerEntityContract, dockerEntityStreamContract, dockerEntityInspectContract, dockerEntityListContract, dockerEntityListInputSchema, dockerEntityInspectInputSchema, dockerEntityStreamInputSchema } from "./entity";

export const dockerContract = oc.tag("Core Docker").prefix("/docker").router({
  containers: dockerContainersContract,
  images: dockerImagesContract,
  networks: dockerNetworksContract,
  volumes: dockerVolumesContract,
  registries: dockerRegistriesContract,
  stacks: dockerStacksContract,
  runtime: dockerRuntimeContract,
  entity: dockerEntityContract,
});

export type DockerContract = typeof dockerContract;

export {
  dockerContainersContract,
  dockerContainerCreateDirectoryContract,
  dockerContainerDeletePathContract,
  dockerContainerFilesContract,
  dockerListContainersContract,
  dockerListContainersGroupedContract,
  dockerContainerLogsStreamContract,
  dockerContainerLinkedListContract,
  dockerContainerProcessLogsStreamContract,
  dockerContainerProcessesContract,
  dockerContainerProcessesStreamContract,
  dockerContainerReadFileContract,
  dockerContainerRenamePathContract,
  dockerContainerInspectContract,
  dockerContainerRuntimeActionContract,
  dockerContainerInspectStreamContract,
  dockerContainerTerminalCloseContract,
  dockerContainerTerminalInputContract,
  dockerContainerTerminalOpenContract,
  dockerContainerTerminalStreamContract,
  dockerContainerWriteFileContract,
  dockerImagesContract,
  dockerImageInspectContract,
  dockerImageSecurityScanStreamContract,
  dockerImageInspectStreamContract,
  dockerListImagesContract,
  dockerNetworksContract,
  dockerListNetworksContract,
  dockerVolumesContract,
  dockerListVolumesContract,
  dockerRegistriesContract,
  dockerListRegistriesContract,
  dockerStacksContract,
  dockerListStacksContract,
  dockerRuntimeContract,
  dockerRuntimeEventsStreamContract,
  dockerRuntimeSnapshotContract,
  dockerEntityContract,
  dockerEntityListContract,
  dockerEntityInspectContract,
  dockerEntityStreamContract,
  dockerEntityListInputSchema,
  dockerEntityInspectInputSchema,
  dockerEntityStreamInputSchema,
};

export type {
  DockerEntityListInput,
  DockerEntityInspectInput,
  DockerEntityStreamInput,
} from "./entity";
