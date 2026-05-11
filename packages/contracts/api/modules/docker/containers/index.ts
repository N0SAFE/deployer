import { oc } from "@orpc/contract";

import { dockerListContainersContract } from "./list";
import { dockerListContainersGroupedContract } from "./list-grouped";
import { dockerContainerLinkedListContract } from "./linked-list";
import { dockerContainerInspectContract } from "./inspect";
import { dockerContainerActionsContract } from "./actions";
import { dockerContainerStreamsContract } from "./streams";
import {
  dockerContainerProcessesNamespaceContract,
  dockerContainerProcessesContract,
} from "./processes";
import {
  dockerContainerLogsContract,
  dockerContainerLogsListContract,
} from "./logs";
import {
  dockerContainerFilesystemContract,
  dockerContainerCreateDirectoryContract,
  dockerContainerDeletePathContract,
  dockerContainerFilesContract,
  dockerContainerReadFileContract,
  dockerContainerRenamePathContract,
  dockerContainerWriteFileContract,
} from "./filesystem";
import {
  dockerContainerTerminalContract,
  dockerContainerTerminalCloseContract,
  dockerContainerTerminalInputContract,
  dockerContainerTerminalOpenContract,
  dockerContainerTerminalStreamContract,
} from "./terminal";
import { dockerContainerRuntimeActionContract } from "./runtime-action";
import {
  dockerContainerInspectStreamContract,
  dockerContainerLogsStreamContract,
  dockerContainerProcessLogsStreamContract,
  dockerContainerProcessesStreamContract,
} from "./streams";

export const dockerContainersContract = oc.tag("Docker Containers").prefix("/containers").router({
  list: dockerListContainersContract,
  grouped: dockerListContainersGroupedContract,
  linked: dockerContainerLinkedListContract,
  inspect: dockerContainerInspectContract,
  actions: dockerContainerActionsContract,
  streams: dockerContainerStreamsContract,
  processes: dockerContainerProcessesNamespaceContract,
  logs: dockerContainerLogsContract,
  filesystem: dockerContainerFilesystemContract,
  terminal: dockerContainerTerminalContract,
});

export {
  dockerListContainersContract,
  dockerListContainersGroupedContract,
  dockerContainerLinkedListContract,
  dockerContainerInspectContract,
  dockerContainerRuntimeActionContract,
  dockerContainerInspectStreamContract,
  dockerContainerLogsStreamContract,
  dockerContainerProcessesContract,
  dockerContainerLogsListContract,
  dockerContainerProcessesStreamContract,
  dockerContainerProcessLogsStreamContract,
  dockerContainerFilesContract,
  dockerContainerReadFileContract,
  dockerContainerWriteFileContract,
  dockerContainerDeletePathContract,
  dockerContainerRenamePathContract,
  dockerContainerCreateDirectoryContract,
  dockerContainerTerminalOpenContract,
  dockerContainerTerminalStreamContract,
  dockerContainerTerminalInputContract,
  dockerContainerTerminalCloseContract,
};

export {
  dockerContainerListConfigSchemas,
  dockerContainerListInputSchema,
  dockerContainerGroupedListSchema,
  dockerContainerInspectQuerySchema,
  dockerContainerInspectStreamQuerySchema,
  dockerContainerRuntimeActionBodySchema,
  dockerContainerRuntimeActionAckSchema,
  dockerContainerLinkedListQuerySchema,
  dockerContainerLogsStreamQuerySchema,
  dockerContainerLogsSnapshotSchema,
  dockerContainerProcessesQuerySchema,
  dockerContainerProcessesStreamQuerySchema,
  dockerContainerProcessLogsStreamQuerySchema,
  dockerContainerFilesQuerySchema,
  dockerContainerReadFileQuerySchema,
  dockerContainerWriteFileBodySchema,
  dockerContainerDeletePathBodySchema,
  dockerContainerRenamePathBodySchema,
  dockerContainerCreateDirectoryBodySchema,
  dockerContainerTerminalOpenBodySchema,
  dockerContainerTerminalStreamQuerySchema,
  dockerContainerTerminalInputBodySchema,
  dockerContainerTerminalCloseBodySchema,
} from "./shared";

export type {
  DockerContainerListInput,
  DockerContainerGroupedListInput,
  DockerContainerGroupedListItem,
  DockerContainerGroupedListResult,
  DockerContainerInspectQueryInput,
  DockerContainerInspectStreamQueryInput,
  DockerContainerRuntimeActionBodyInput,
  DockerContainerRuntimeActionAck,
  DockerContainerLinkedListQueryInput,
  DockerContainerLogsStreamQueryInput,
  DockerContainerLogsSnapshot,
  DockerContainerProcessesQueryInput,
  DockerContainerProcessesStreamQueryInput,
  DockerContainerProcessLogsStreamQueryInput,
  DockerContainerFilesQueryInput,
  DockerContainerReadFileQueryInput,
  DockerContainerWriteFileBodyInput,
  DockerContainerDeletePathBodyInput,
  DockerContainerRenamePathBodyInput,
  DockerContainerCreateDirectoryBodyInput,
  DockerContainerTerminalOpenBodyInput,
  DockerContainerTerminalStreamQueryInput,
  DockerContainerTerminalInputBodyInput,
  DockerContainerTerminalCloseBodyInput,
} from "./shared";