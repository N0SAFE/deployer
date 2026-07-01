/**
 * @fileoverview Zod schemas for raw dockerode volume API responses.
 */

import z from "zod/v4"

// ─── Volume entry (docker.listVolumes → Volumes[]) ────────────────────────────

export const dockerodeVolumeEntrySchema = z.object({
  /** Volume name */
  Name: z.string(),
  /** Volume driver */
  Driver: z.string().optional(),
  /** Mountpoint path on host */
  Mountpoint: z.string().optional(),
  /** Created timestamp */
  CreatedAt: z.string().optional(),
  /** Volume status (driver-specific) */
  Status: z.record(z.string(), z.string()).optional(),
  /** Labels */
  Labels: z.record(z.string(), z.string()).default({}),
  /** Scope (local, global) */
  Scope: z.string().optional(),
  /** Options (driver-specific) */
  Options: z.record(z.string(), z.string()).optional(),
  /** Usage data */
  UsageData: z
    .object({
      Size: z.number().optional(),
      RefCount: z.number().optional(),
    })
    .passthrough()
    .optional(),
}).passthrough()

export type DockerodeVolumeEntry = z.infer<typeof dockerodeVolumeEntrySchema>

// ─── Volume list response (docker.listVolumes) ────────────────────────────────

export const dockerodeVolumeListResponseSchema = z.object({
  Volumes: z.array(dockerodeVolumeEntrySchema).default([]),
  Warnings: z.array(z.string()).optional(),
}).passthrough()

export type DockerodeVolumeListResponse = z.infer<typeof dockerodeVolumeListResponseSchema>
