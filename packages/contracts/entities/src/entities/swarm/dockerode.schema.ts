/**
 * @fileoverview Raw dockerode Swarm API response schemas.
 *
 * These schemas describe the raw JSON returned by the Docker Engine API
 * (via dockerode) for Swarm mode. They are the validation boundary at the
 * `DockerService` → engine edge: raw engine output is Zod-parsed here
 * (parse, don't validate), so business code never needs `as Record<string, unknown>`
 * casts. `passthrough()` keeps us tolerant of additive engine fields while
 * the fields the platform reads are strictly typed.
 *
 * Mirrors the existing pattern in `entities/docker/dockerode/`.
 */

import z from 'zod/v4'

// ─── Swarm mode state (GET /info → .Swarm) ──────────────────────────────────

export const swarmLocalNodeStateSchema = z.enum(['inactive', 'pending', 'active', 'error', 'locked'])
export type SwarmLocalNodeState = z.infer<typeof swarmLocalNodeStateSchema>

export const dockerodeSwarmInfoSchema = z
  .object({
    NodeID: z.string().default(''),
    NodeAddr: z.string().default(''),
    LocalNodeState: swarmLocalNodeStateSchema.default('inactive'),
    ControlAvailable: z.boolean().default(false),
    Error: z.string().default(''),
    /** NOT in a swarm ⇒ the engine reports `null` (not `[]`). */
    RemoteManagers: z
      .array(
        z
          .object({
            NodeID: z.string(),
            Addr: z.string(),
          })
          .passthrough(),
      )
      .nullable()
      .default(null),
    Nodes: z.number().int().nonnegative().default(0),
    Managers: z.number().int().nonnegative().default(0),
  })
  .passthrough()
export type DockerodeSwarmInfo = z.infer<typeof dockerodeSwarmInfoSchema>

// ─── Swarm inspect (GET /swarm → .Swarm) ────────────────────────────────────

export const dockerodeSwarmInspectSchema = z
  .object({
    ID: z.string().default(''),
    Version: z
      .object({
        Index: z.number().default(0),
      })
      .passthrough()
      .optional(),
    Spec: z
      .object({
        Name: z.string().optional(),
        Labels: z.record(z.string(), z.string()).default({}),
      })
      .passthrough()
      .optional(),
    JoinTokens: z
      .object({
        Worker: z.string().default(''),
        Manager: z.string().default(''),
      })
      .passthrough()
      .optional(),
    Cluster: z
      .object({})
      .passthrough()
      .optional(),
  })
  .passthrough()
export type DockerodeSwarmInspect = z.infer<typeof dockerodeSwarmInspectSchema>

// ─── Swarm init / join request bodies (POST /swarm/init, POST /swarm/join) ──

export const swarmInitOptionsSchema = z
  .object({
    ListenAddr: z.string().optional(),
    AdvertiseAddr: z.string().optional(),
    ForceNewCluster: z.boolean().optional(),
    Spec: z
      .object({
        Name: z.string().optional(),
        Labels: z.record(z.string(), z.string()).optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
export type SwarmInitOptions = z.infer<typeof swarmInitOptionsSchema>

export const swarmJoinOptionsSchema = z
  .object({
    ListenAddr: z.string().optional(),
    AdvertiseAddr: z.string().optional(),
    RemoteAddrs: z.array(z.string().min(1)).min(1),
    JoinToken: z.string().min(1),
  })
  .passthrough()
export type SwarmJoinOptions = z.infer<typeof swarmJoinOptionsSchema>

// ─── Service (GET /services, GET /services/{id}) ────────────────────────────

export const dockerodeServiceSummarySchema = z
  .object({
    ID: z.string().min(1),
    Version: z
      .object({
        Index: z.number().default(0),
      })
      .passthrough()
      .default({ Index: 0 }),
    CreatedAt: z.string().default(''),
    UpdatedAt: z.string().default(''),
    Spec: z
      .object({
        Name: z.string().default(''),
        Labels: z.record(z.string(), z.string()).default({}),
        TaskTemplate: z
          .object({
            ContainerSpec: z
              .object({
                Image: z.string().optional(),
                Labels: z.record(z.string(), z.string()).default({}),
              })
              .passthrough()
              .optional(),
            Networks: z
              .array(
                z
                  .object({
                    Target: z.string().optional(),
                    Aliases: z.array(z.string()).optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .passthrough()
          .optional(),
        Mode: z
          .object({
            Replicated: z
              .object({
                Replicas: z.number().int().nonnegative().nullable().optional(),
              })
              .passthrough()
              .optional(),
            Global: z
              .object({})
              .passthrough()
              .optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .default({ Name: '', Labels: {} }),
    Endpoint: z
      .object({
        VirtualIPs: z
          .array(
            z
              .object({
                NetworkID: z.string().optional(),
                Addr: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
    UpdateStatus: z
      .object({
        State: z.string().optional(),
        StartedAt: z.string().optional(),
        Message: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough()
export type DockerodeServiceSummary = z.infer<typeof dockerodeServiceSummarySchema>

// ─── Task (GET /services/{id}/tasks) ────────────────────────────────────────

export const dockerodeTaskSummarySchema = z
  .object({
    ID: z.string().min(1),
    Version: z
      .object({
        Index: z.number().default(0),
      })
      .passthrough()
      .default({ Index: 0 }),
    ServiceID: z.string().default(''),
    NodeID: z.string().nullable().optional(),
    Slot: z.number().int().nullable().optional(),
    DesiredState: z.string().default(''),
    Status: z
      .object({
        State: z.string().default(''),
        Message: z.string().optional(),
        Err: z.string().optional(),
        Timestamp: z.string().optional(),
        ContainerStatus: z
          .object({
            ContainerID: z.string().optional(),
            PID: z.number().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .default({ State: '' }),
  })
  .passthrough()
export type DockerodeTaskSummary = z.infer<typeof dockerodeTaskSummarySchema>

// ─── Node (GET /nodes) ──────────────────────────────────────────────────────

export const dockerodeNodeSummarySchema = z
  .object({
    ID: z.string().min(1),
    Version: z
      .object({
        Index: z.number().default(0),
      })
      .passthrough()
      .default({ Index: 0 }),
    CreatedAt: z.string().default(''),
    UpdatedAt: z.string().default(''),
    Spec: z
      .object({
        Name: z.string().default(''),
        Labels: z.record(z.string(), z.string()).default({}),
        Role: z.string().default('worker'),
        Availability: z.string().default('active'),
      })
      .passthrough()
      .default({ Name: '', Labels: {}, Role: 'worker', Availability: 'active' }),
    Description: z
      .object({
        Hostname: z.string().default(''),
        Platform: z
          .object({
            Architecture: z.string().optional(),
            OS: z.string().optional(),
          })
          .passthrough()
          .optional(),
        Resources: z
          .object({
            NanoCPUs: z.number().optional(),
            MemoryBytes: z.number().optional(),
          })
          .passthrough()
          .optional(),
        Engine: z
          .object({
            EngineVersion: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .default({ Hostname: '' }),
    Status: z
      .object({
        State: z.string().default(''),
        Message: z.string().optional(),
        Addr: z.string().optional(),
      })
      .passthrough()
      .default({ State: '' }),
    ManagerStatus: z
      .object({
        Leader: z.boolean().optional(),
        Reachability: z.string().optional(),
        Addr: z.string().optional(),
      })
      .passthrough()
      .nullable()
      .default(null),
  })
  .passthrough()
export type DockerodeNodeSummary = z.infer<typeof dockerodeNodeSummarySchema>

// ─── Secret / Config (GET /secrets, GET /configs) ───────────────────────────

export const dockerodeSecretSummarySchema = z
  .object({
    ID: z.string().min(1),
    Version: z
      .object({
        Index: z.number().default(0),
      })
      .passthrough()
      .default({ Index: 0 }),
    CreatedAt: z.string().default(''),
    UpdatedAt: z.string().default(''),
    Spec: z
      .object({
        Name: z.string().default(''),
        Labels: z.record(z.string(), z.string()).default({}),
      })
      .passthrough()
      .default({ Name: '', Labels: {} }),
  })
  .passthrough()
export type DockerodeSecretSummary = z.infer<typeof dockerodeSecretSummarySchema>

export const dockerodeConfigSummarySchema = z
  .object({
    ID: z.string().min(1),
    Version: z
      .object({
        Index: z.number().default(0),
      })
      .passthrough()
      .default({ Index: 0 }),
    CreatedAt: z.string().default(''),
    UpdatedAt: z.string().default(''),
    Spec: z
      .object({
        Name: z.string().default(''),
        Labels: z.record(z.string(), z.string()).default({}),
      })
      .passthrough()
      .default({ Name: '', Labels: {} }),
  })
  .passthrough()
export type DockerodeConfigSummary = z.infer<typeof dockerodeConfigSummarySchema>