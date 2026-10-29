import { implement } from "@orpc/server";

import { runtimeNodeContract } from "@deployer/runtime-contracts/mesh/index";

import type { LocalNodeOperations } from "./local-node-operations";

/**
 * What this node answers when the mesh asks about its own docker engine, as the runtime's node router.
 *
 * Each procedure is one local operation and nothing else: the answer carries no responder and no envelope, because the
 * mesh already pinned the call to this node. The operations are the same ones the old topic handlers used
 * (`LocalNodeOperations`), so the two surfaces answer identically until the old one is removed.
 */
export function buildNodeRouter(local: LocalNodeOperations) {
  const c = runtimeNodeContract;

  return {
    containers: {
      list: implement(c.containers.list).handler(async ({ input }) => {
        const [page, daemonId] = await Promise.all([local.listContainers(input), local.getLocalDockerDaemonId()]);
        return { data: page.data, meta: page.meta, daemonId };
      }),
      inspect: implement(c.containers.inspect).handler(async ({ input }) => ({ detail: await local.inspectContainer(input.containerId) })),
      catalog: implement(c.containers.catalog).handler(async () => ({ catalog: await local.getRuntimeCatalogSnapshot() })),
    },
    runtime: {
      logs: implement(c.runtime.logs).handler(({ input }) => local.logsSnapshot(input)),
      processes: implement(c.runtime.processes).handler(({ input }) => local.processes(input)),
      processLogs: implement(c.runtime.processLogs).handler(({ input }) => local.processLogsSnapshot(input)),
      files: implement(c.runtime.files).handler(({ input }) => local.listFiles(input)),
      readFile: implement(c.runtime.readFile).handler(({ input }) => local.readFile(input)),
      writeFile: implement(c.runtime.writeFile).handler(({ input }) => local.writeFile(input)),
      deletePath: implement(c.runtime.deletePath).handler(({ input }) => local.deletePath(input)),
      renamePath: implement(c.runtime.renamePath).handler(({ input }) => local.renamePath(input)),
      createDirectory: implement(c.runtime.createDirectory).handler(({ input }) => local.createDirectory(input)),
      terminalOpen: implement(c.runtime.terminalOpen).handler(({ input }) => local.openTerminal(input)),
      terminalEvents: implement(c.runtime.terminalEvents).handler(({ input }) => local.terminalEvents(input)),
      terminalInput: implement(c.runtime.terminalInput).handler(({ input }) => local.sendTerminalInput(input)),
      terminalClose: implement(c.runtime.terminalClose).handler(({ input }) => local.closeTerminal(input)),
    },
    images: {
      inspect: implement(c.images.inspect).handler(async ({ input }) => ({ detail: await local.inspectImage(input.imageId) })),
    },
  };
}

/** Every container id on this node, page by page: what a node announces to the mesh as the resources it holds. */
export async function containerIds(local: Pick<LocalNodeOperations, "listContainers">): Promise<readonly string[]> {
  const ids: string[] = [];
  const limit = 500;
  for (let offset = 0; ; offset += limit) {
    const page = await local.listContainers({ limit, offset });
    ids.push(...page.data.map((container) => container.id));
    if (!page.meta.hasMore) {
      return ids;
    }
  }
}
