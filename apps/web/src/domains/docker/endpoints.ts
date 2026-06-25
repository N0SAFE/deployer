import { orpc } from '@/lib/orpc'

export const dockerEndpoints = {
  containers: {
    list: orpc.docker.containers.list,
    grouped: orpc.docker.containers.grouped,
    linked: orpc.docker.containers.linked,
    inspect: orpc.docker.containers.inspect,
    actions: {
      run: orpc.docker.containers.actions.run,
    },
    streams: {
      inspect: orpc.docker.containers.streams.inspect,
      logs: orpc.docker.containers.streams.logs,
      processes: orpc.docker.containers.streams.processes,
      processLogs: orpc.docker.containers.streams.processLogs,
    },
    logs: {
      list: orpc.docker.containers.logs.list,
    },
    processes: {
      list: orpc.docker.containers.processes.list,
    },
    filesystem: {
      list: orpc.docker.containers.filesystem.list,
      read: orpc.docker.containers.filesystem.read,
      write: orpc.docker.containers.filesystem.write,
      deletePath: orpc.docker.containers.filesystem.deletePath,
      renamePath: orpc.docker.containers.filesystem.renamePath,
      createDirectory: orpc.docker.containers.filesystem.createDirectory,
    },
    terminal: {
      open: orpc.docker.containers.terminal.open,
      stream: orpc.docker.containers.terminal.stream,
      sendInput: orpc.docker.containers.terminal.sendInput,
      close: orpc.docker.containers.terminal.close,
    },
  },
  images: {
    list: orpc.docker.images.list,
    inspect: orpc.docker.images.inspect,
    streams: {
      inspect: orpc.docker.images.streams.inspect,
    },
    security: {
      scanning: {
        stream: orpc.docker.images.security.scanning.stream,
      },
    },
  },
  networks: {
    list: orpc.docker.networks.list,
  },
  volumes: {
    list: orpc.docker.volumes.list,
  },
  registries: {
    list: orpc.docker.registries.list,
  },
  stacks: {
    list: orpc.docker.stacks.list,
  },
  runtime: {
    snapshot: orpc.docker.runtime.snapshot,
    stream: orpc.docker.runtime.stream,
    activity: {
      list: orpc.docker.runtime.activity.list,
      detail: orpc.docker.runtime.activity.detail,
      stream: orpc.docker.runtime.activityStream,
    },
  },
  entity: {
    list: orpc.docker.entity.list,
    inspect: orpc.docker.entity.inspect,
    stream: orpc.docker.entity.stream,
  },
} as const

export type DockerEndpoints = typeof dockerEndpoints
