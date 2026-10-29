import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

import * as s from "./schemas";

const meta = (tag: string, prefix: `/${string}`) => oc.meta(openapi({ tags: [tag], prefix }));

/** What a node answers about its own containers. */
const containers = meta("Node containers", "/mesh/node/containers").router({
  list: standard.zod(s.dockerContainerListResponseSchema, "nodeContainerList").create().path("/list").input((b) => b.body(s.dockerContainerListQuerySchema)).output(s.dockerContainerListResponseSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  inspect: standard.zod(s.dockerContainerInspectResponseSchema, "nodeContainerInspect").create().path("/inspect").input((b) => b.body(s.dockerContainerInspectQuerySchema)).output(s.dockerContainerInspectResponseSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  catalog: standard.zod(s.dockerRuntimeCatalogResponseSchema, "nodeRuntimeCatalog").create().path("/catalog").input((b) => b.body(z.object({}))).output(s.dockerRuntimeCatalogResponseSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
});

/** What a node does inside one of its own containers: logs, processes, files and terminals. */
const runtime = meta("Node container runtime", "/mesh/node/runtime").router({
  logs: standard.zod(s.containerLogsSnapshotSchema, "nodeContainerLogs").create().path("/logs").input((b) => b.body(s.containerLogsQuerySchema)).output(s.containerLogsSnapshotSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  processes: standard.zod(s.containerProcessesSnapshotSchema, "nodeContainerProcesses").create().path("/processes").input((b) => b.body(s.containerProcessesQuerySchema)).output(s.containerProcessesSnapshotSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  processLogs: standard.zod(s.containerLogsSnapshotSchema, "nodeContainerProcessLogs").create().path("/process-logs").input((b) => b.body(s.containerProcessLogsQuerySchema)).output(s.containerLogsSnapshotSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  files: standard.zod(s.containerFilesSnapshotSchema, "nodeContainerFiles").create().path("/files").input((b) => b.body(s.containerFilesQuerySchema)).output(s.containerFilesSnapshotSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  readFile: standard.zod(s.containerReadFileSnapshotSchema, "nodeContainerReadFile").create().path("/read-file").input((b) => b.body(s.containerReadFileQuerySchema)).output(s.containerReadFileSnapshotSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  writeFile: standard.zod(s.containerMutationAckSchema, "nodeContainerWriteFile").create().path("/write-file").input((b) => b.body(s.containerWriteFileBodySchema)).output(s.containerMutationAckSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  deletePath: standard.zod(s.containerMutationAckSchema, "nodeContainerDeletePath").create().path("/delete-path").input((b) => b.body(s.containerDeletePathBodySchema)).output(s.containerMutationAckSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  renamePath: standard.zod(s.containerMutationAckSchema, "nodeContainerRenamePath").create().path("/rename-path").input((b) => b.body(s.containerRenamePathBodySchema)).output(s.containerMutationAckSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  createDirectory: standard.zod(s.containerMutationAckSchema, "nodeContainerCreateDirectory").create().path("/create-directory").input((b) => b.body(s.containerCreateDirectoryBodySchema)).output(s.containerMutationAckSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  terminalOpen: standard.zod(s.containerTerminalOpenResultSchema, "nodeTerminalOpen").create().path("/terminal/open").input((b) => b.body(s.containerTerminalOpenBodySchema)).output(s.containerTerminalOpenResultSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  terminalEvents: standard.zod(s.containerTerminalEventsSnapshotSchema, "nodeTerminalEvents").create().path("/terminal/events").input((b) => b.body(s.containerTerminalEventsQuerySchema)).output(s.containerTerminalEventsSnapshotSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  terminalInput: standard.zod(s.containerMutationAckSchema, "nodeTerminalInput").create().path("/terminal/input").input((b) => b.body(s.containerTerminalInputBodySchema)).output(s.containerMutationAckSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
  terminalClose: standard.zod(s.containerMutationAckSchema, "nodeTerminalClose").create().path("/terminal/close").input((b) => b.body(s.containerTerminalCloseBodySchema)).output(s.containerMutationAckSchema).errors((e) => [...standardDomainErrorContracts(e)]).build(),
});

/** What a node answers about its own images. */
const images = meta("Node images", "/mesh/node/images").router({
  inspect: standard.zod(z.object({ detail: s.dockerImageInspectDetailSchema }), "nodeImageInspect").create().path("/inspect").input((b) => b.body(s.imageInspectQuerySchema)).output(z.object({ detail: s.dockerImageInspectDetailSchema })).errors((e) => [...standardDomainErrorContracts(e)]).build(),
});

/**
 * The runtime's node router: the operations one node answers about its own docker engine, for the callers that reach it
 * through the mesh. Internal: never composed into the public BFF router.
 */
export const runtimeNodeContract = { containers, runtime, images };

export type RuntimeNodeContract = typeof runtimeNodeContract;

export * from "./schemas";
