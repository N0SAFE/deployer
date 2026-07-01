/**
 * @fileoverview Zod schemas for raw dockerode container API responses.
 *
 * These schemas validate the raw JSON returned by dockerode API calls
 * (listContainers, getContainer().inspect()). They are deliberately
 * **partial** — only fields actually accessed by the codebase are
 * included. Missing fields are silently dropped at parse time.
 *
 * ## Why separate from the domain schemas?
 *
 * The domain schemas (`../containers/base.schema.ts`) describe the
 * application-level container entity AFTER normalization. These
 * dockerode schemas describe what the Docker daemon actually returns
 * over the socket — nested, snake_case, dockerode-idiomatic shapes.
 *
 * ## Usage
 *
 * ```typescript
 * import { dockerodeContainerListSchema } from "@repo/contracts-entities"
 *
 * const raw = await docker.listContainers({ all: true })
 * const parsed = z.array(dockerodeContainerListSchema).parse(raw)
 * // parsed: DockerodeContainerList[]
 * ```
 *
 * @see dockerode-container-inspect.schema.ts — the inspect response
 */

import z from "zod/v4"

// ─── Container summary (docker.listContainers) ───────────────────────────────

/**
 * Port as returned by docker.listContainers().
 * Each container summary includes an array of these.
 */
export const dockerodePortSchema = z.object({
  IP: z.string().optional(),
  PrivatePort: z.number().optional(),
  PublicPort: z.number().optional(),
  Type: z.string().optional(),
})

export type DockerodePort = z.infer<typeof dockerodePortSchema>

/**
 * Port binding as returned by docker.getContainer().inspect().
 * The HostConfig.PortBindings map uses these as array values.
 */
export const dockerodePortBindingSchema = z.object({
  HostIp: z.string().optional(),
  HostPort: z.string().optional(),
})

export type DockerodePortBinding = z.infer<typeof dockerodePortBindingSchema>

export const dockerodeMountSchema = z.object({
  Type: z.enum(["bind", "volume", "tmpfs", "npipe"]).optional(),
  Name: z.string().optional(),
  Source: z.string().optional(),
  Destination: z.string().optional(),
  Driver: z.string().optional(),
  Mode: z.string().optional(),
  RW: z.boolean().optional(),
  Propagation: z.string().optional(),
})

export type DockerodeMount = z.infer<typeof dockerodeMountSchema>

export const dockerodeContainerListSchema = z.object({
  Id: z.string(),
  Names: z.array(z.string()).default([]),
  Image: z.string().optional(),
  ImageID: z.string().optional(),
  Labels: z.record(z.string(), z.string()).default({}),
  State: z.string().optional(),
  Status: z.string().optional(),
  Ports: z.array(dockerodePortSchema).default([]),
  Mounts: z.array(dockerodeMountSchema).default([]),
  Created: z.number().optional(),
  /** Docker network settings (partial — only what we read) */
  NetworkSettings: z
    .object({
      Networks: z
        .record(z.string(),
          z.object({
            NetworkID: z.string().optional(),
            IPAddress: z.string().optional(),
            GlobalIPv6Address: z.string().optional(),
            Gateway: z.string().optional(),
            MacAddress: z.string().optional(),
            Aliases: z.array(z.string()).optional(),
          }),
        )
        .optional(),
    })
    .optional(),
  HostConfig: z
    .object({
      NetworkMode: z.string().optional(),
    })
    .optional(),
})

export type DockerodeContainerList = z.infer<typeof dockerodeContainerListSchema>

// ─── Container inspect (docker.getContainer(id).inspect) ─────────────────────

export const dockerodeNetworkAttachmentSchema = z.object({
  /** Docker network ID */
  NetworkID: z.string().optional(),
  /** Endpoint ID within the network */
  EndpointID: z.string().optional(),
  /** Gateway IP */
  Gateway: z.string().optional(),
  /** Container's IPv4 address on this network */
  IPAddress: z.string().optional(),
  /** Container's IPv6 address on this network */
  GlobalIPv6Address: z.string().optional(),
  /** Subnet prefix length */
  IPPrefixLen: z.number().optional(),
  /** IPv6 subnet prefix length */
  GlobalIPv6PrefixLen: z.number().optional(),
  /** MAC address on this network */
  MacAddress: z.string().optional(),
  /** DNS aliases for this endpoint */
  Aliases: z.array(z.string()).optional(),
  /** DNS server IPs */
  DnsNames: z.array(z.string()).optional(),
})

export type DockerodeNetworkAttachment = z.infer<typeof dockerodeNetworkAttachmentSchema>

export const dockerodePortMapSchema = z.object({
  /** Host IP (e.g. "0.0.0.0") */
  HostIp: z.string().optional(),
  /** Host port as a string (e.g. "8080") */
  HostPort: z.string().optional(),
})

export type DockerodePortMap = z.infer<typeof dockerodePortMapSchema>

export const dockerodeHealthcheckConfigSchema = z.object({
  /** Health check command (array form) */
  Test: z.array(z.string()).optional(),
  /** Interval between checks (nanoseconds) */
  Interval: z.number().optional(),
  /** Timeout per check (nanoseconds) */
  Timeout: z.number().optional(),
  /** Consecutive failures before unhealthy */
  Retries: z.number().optional(),
  /** Start period before health check begins (nanoseconds) */
  StartPeriod: z.number().optional(),
}).passthrough()

export const dockerodeRestartPolicySchema = z.object({
  /** Restart policy name */
  Name: z.string().optional(),
  /** Maximum retry count */
  MaximumRetryCount: z.number().optional(),
}).passthrough()

export const dockerodeContainerInspectSchema = z.object({
  /** Container ID */
  Id: z.string().optional(),
  /** Container name (with leading /) */
  Name: z.string().optional(),
  /** Platform (e.g. "linux") */
  Platform: z.string().optional(),
  /** Container creation timestamp */
  Created: z.string().optional(),
  /** Path to the command */
  Path: z.string().optional(),
  /** Command arguments */
  Args: z.array(z.string()).optional(),

  /** Container state */
  State: z
    .object({
      Status: z.string().optional(),
      Running: z.boolean().optional(),
      Paused: z.boolean().optional(),
      Restarting: z.boolean().optional(),
      OOMKilled: z.boolean().optional(),
      Dead: z.boolean().optional(),
      Pid: z.number().optional(),
      ExitCode: z.number().optional(),
      StartedAt: z.string().optional(),
      FinishedAt: z.string().optional(),
      Health: z
        .object({
          Status: z.string().optional(),
          FailingStreak: z.number().optional(),
          Log: z
            .array(
              z.object({
                Start: z.string().optional(),
                Output: z.string().optional(),
                ExitCode: z.number().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
    })
    .passthrough()
    .optional(),

  /** Container configuration */
  Config: z
    .object({
      /** Hostname */
      Hostname: z.string().optional(),
      /** Exposed ports */
      ExposedPorts: z.record(z.string(), z.object({})).optional(),
      /** Environment variables (["KEY=VALUE", ...]) */
      Env: z.array(z.string()).optional(),
      /** Command */
      Cmd: z.array(z.string()).optional(),
      /** Entrypoint */
      Entrypoint: z.string().or(z.array(z.string())).optional(),
      /** Image reference */
      Image: z.string().optional(),
      /** Labels */
      Labels: z.record(z.string(), z.string()).optional(),
      /** Working directory */
      WorkingDir: z.string().optional(),
      /** User */
      User: z.string().optional(),
      /** Health check config */
      Healthcheck: dockerodeHealthcheckConfigSchema.optional(),
      /** Stop signal */
      StopSignal: z.string().optional(),
      /** Stop timeout (seconds) */
      StopTimeout: z.number().optional(),
    })
    .passthrough()
    .optional(),

  /** Host configuration */
  HostConfig: z
    .object({
      /** Network mode */
      NetworkMode: z.string().optional(),
      /** PID mode */
      PidMode: z.string().optional(),
      /** IPC mode */
      IpcMode: z.string().optional(),
      /** Cgroup namespace mode */
      CgroupnsMode: z.string().optional(),
      /** Privileged mode */
      Privileged: z.boolean().optional(),
      /** Read-only root filesystem */
      ReadonlyRootfs: z.boolean().optional(),
      /** Restart policy */
      RestartPolicy: dockerodeRestartPolicySchema.optional(),
      /** DNS servers */
      Dns: z.array(z.string()).optional(),
      /** DNS search domains */
      DnsSearch: z.array(z.string()).optional(),
      /** DNS options */
      DnsOptions: z.array(z.string()).optional(),
      /** Extra hosts entries */
      ExtraHosts: z.array(z.string()).optional(),
      /** Memory limit (bytes) */
      Memory: z.number().optional(),
      /** Memory reservation (bytes) */
      MemoryReservation: z.number().optional(),
      /** CPU quota (nanocpus) */
      NanoCpus: z.number().optional(),
      /** CPU shares (relative weight) */
      CpuShares: z.number().optional(),
      /** Volume binds */
      Binds: z.array(z.string()).optional(),
      /** Tmpfs mounts */
      Tmpfs: z.record(z.string(), z.string()).optional(),
      /** Volumes from other containers */
      VolumesFrom: z.array(z.string()).optional(),
      /** OOM kill disable */
      OomKillDisable: z.boolean().optional(),
      /** Init process */
      Init: z.boolean().optional(),
    })
    .passthrough()
    .optional(),

  /** Network settings */
  NetworkSettings: z
    .object({
      /** Port bindings */
      Ports: z.record(z.string(), z.array(dockerodePortMapSchema)).default({}),
      /** Network attachments */
      Networks: z.record(z.string(), dockerodeNetworkAttachmentSchema).default({}),
      /** Gateway */
      Gateway: z.string().optional(),
      /** IP Address */
      IPAddress: z.string().optional(),
    })
    .passthrough()
    .optional(),

  /** Mounts */
  Mounts: z.array(dockerodeMountSchema).optional(),

  /** Root filesystem info */
  RootFS: z
    .object({
      Type: z.string().optional(),
      Layers: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),

  /** Graph driver info */
  GraphDriver: z
    .object({
      Name: z.string().optional(),
      Data: z.record(z.string(), z.string()).optional(),
    })
    .passthrough()
    .optional(),
}).passthrough()

export type DockerodeContainerInspect = z.infer<typeof dockerodeContainerInspectSchema>
