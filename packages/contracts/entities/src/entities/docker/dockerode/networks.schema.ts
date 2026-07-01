/**
 * @fileoverview Zod schemas for raw dockerode network API responses.
 */

import z from "zod/v4"

// ─── Network summary (docker.listNetworks) ────────────────────────────────────

export const dockerodeNetworkIpamConfigSchema = z.object({
  Subnet: z.string().optional(),
  Gateway: z.string().optional(),
  IPRange: z.string().optional(),
  AuxAddress: z.record(z.string(), z.string()).optional(),
}).passthrough()

export const dockerodeNetworkIpamSchema = z.object({
  Driver: z.string().optional(),
  Options: z.record(z.string(), z.string()).optional(),
  Config: z.array(dockerodeNetworkIpamConfigSchema).default([]),
}).passthrough()

export const dockerodeNetworkContainerAttachmentSchema = z.object({
  EndpointID: z.string().optional(),
  MacAddress: z.string().optional(),
  IPv4Address: z.string().optional(),
  IPv6Address: z.string().optional(),
}).passthrough()

export const dockerodeNetworkSummarySchema = z.object({
  Id: z.string(),
  Name: z.string(),
  Driver: z.string().optional(),
  Scope: z.string().optional(),
  Internal: z.boolean().optional(),
  Attachable: z.boolean().optional(),
  IPAM: dockerodeNetworkIpamSchema.optional(),
  Containers: z.record(z.string(), dockerodeNetworkContainerAttachmentSchema).default({}),
  Labels: z.record(z.string(), z.string()).default({}),
  Created: z.string().optional(),
  EnableIPv6: z.boolean().optional(),
  Options: z.record(z.string(), z.string()).optional(),
}).passthrough()

export type DockerodeNetworkSummary = z.infer<typeof dockerodeNetworkSummarySchema>

// ─── Network inspect (docker.getNetwork(id).inspect) ──────────────────────────
// Not currently used — the codebase uses listNetworks only
