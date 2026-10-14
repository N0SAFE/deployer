/**
 * Deployments Mesh Entity
 *
 * Entity definition for deployments in the mesh resource system.
 * Uses the modern meshEntity/meshQuery/meshMutation style.
 *
 * This is the MeshResourceService-compatible version of the
 * deploymentsEntity from deployment-mesh.service.ts.
 */

import * as z from "zod";
import { meshEntity } from "@/core/modules/mesh/mesh-entity";
import { meshQuery } from "@/core/modules/mesh/mesh-query";
import { meshMutation } from "@/core/modules/mesh/mesh-mutation";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const deploymentSummarySchema = z.object({
  deploymentId: z.string(),
  serviceId: z.string().nullable().default(null),
  status: z.string().nullable().default(null),
  environment: z.string().nullable().default(null),
  ownerNodeId: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const listDeploymentsInputSchema = z.object({
  serviceId: z.string().optional(),
  projectId: z.string().optional(),
  status: z.string().optional(),
  environment: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});

export const resolveDeploymentInputSchema = z.object({
  deploymentId: z.string(),
  key: z.string().min(1),
});

export const resolveDeploymentOutputSchema = z.object({
  found: z.boolean(),
  ownerNodeId: z.string().nullable().default(null),
  ownerServerUrl: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).nullable().default(null),
});

export const searchDeploymentsInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(25),
});

export type DeploymentSummary = z.infer<typeof deploymentSummarySchema>;
export type ListDeploymentsInput = z.infer<typeof listDeploymentsInputSchema>;
export type ResolveDeploymentInput = z.infer<typeof resolveDeploymentInputSchema>;
export type SearchDeploymentsInput = z.infer<typeof searchDeploymentsInputSchema>;

// ─── Entity ───────────────────────────────────────────────────────────────────

export const deploymentResourceEntity = meshEntity({
  key: "deployments",
  item: deploymentSummarySchema,
  itemKey: "deploymentId",
  queries: {
    list: meshQuery(listDeploymentsInputSchema, deploymentSummarySchema),
    resolve: meshQuery(resolveDeploymentInputSchema, resolveDeploymentOutputSchema),
    search: meshQuery(searchDeploymentsInputSchema, deploymentSummarySchema),
  },
  mutations: {},
});
