/**
 * @fileoverview Zod schemas for raw dockerode image API responses.
 */

import z from "zod/v4"

// ─── Image summary (docker.listImages) ────────────────────────────────────────

export const dockerodeImageSummarySchema = z.object({
  Id: z.string(),
  RepoTags: z.array(z.string()).default([]),
  RepoDigests: z.array(z.string()).default([]),
  Parent: z.string().optional(),
  Comment: z.string().optional(),
  Created: z.number().optional(),
  Size: z.number().optional(),
  VirtualSize: z.number().optional(),
  SharedSize: z.number().optional(),
  Labels: z.record(z.string(), z.string()).default({}),
  Containers: z.number().optional(),
}).passthrough()

export type DockerodeImageSummary = z.infer<typeof dockerodeImageSummarySchema>

// ─── Image inspect (docker.getImage(id).inspect) ──────────────────────────────

export const dockerodeImageConfigSchema = z.object({
  /** Environment variables (["KEY=VALUE", ...]) */
  Env: z.array(z.string()).optional(),
  /** Exposed ports */
  ExposedPorts: z.record(z.string(), z.object({})).optional(),
  /** Default CMD */
  Cmd: z.array(z.string()).optional(),
  /** Default Entrypoint */
  Entrypoint: z.string().or(z.array(z.string())).optional(),
  /** Working directory */
  WorkingDir: z.string().optional(),
  /** User */
  User: z.string().optional(),
  /** Labels */
  Labels: z.record(z.string(), z.string()).optional(),
  /** Stop signal */
  StopSignal: z.string().optional(),
  /** Shell */
  Shell: z.array(z.string()).optional(),
}).passthrough()

export const dockerodeImageInspectSchema = z.object({
  Id: z.string(),
  RepoTags: z.array(z.string()).default([]),
  RepoDigests: z.array(z.string()).default([]),
  Parent: z.string().optional(),
  Comment: z.string().optional(),
  Created: z.string().optional(),
  Size: z.number().optional(),
  VirtualSize: z.number().optional(),
  Architecture: z.string().optional(),
  Os: z.string().optional(),
  Variant: z.string().optional(),
  Author: z.string().optional(),
  DockerVersion: z.string().optional(),
  Labels: z.record(z.string(), z.string()).default({}),
  Config: dockerodeImageConfigSchema.optional(),
  RootFS: z
    .object({
      Type: z.string().optional(),
      Layers: z.array(z.string()).optional(),
    })
    .passthrough()
    .optional(),
  GraphDriver: z
    .object({
      Name: z.string().optional(),
      Data: z.record(z.string(), z.string()).optional(),
    })
    .passthrough()
    .optional(),
}).passthrough()

export type DockerodeImageInspect = z.infer<typeof dockerodeImageInspectSchema>
