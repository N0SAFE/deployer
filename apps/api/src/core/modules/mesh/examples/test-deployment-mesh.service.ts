import { Injectable, Logger } from "@nestjs/common";
import z from "zod/v4";
import { meshEntity } from "../mesh-entity";
import { meshQuery } from "../mesh-query";
import { meshMutation } from "../mesh-mutation";
import type { MeshQueryResult } from "../services/system-mesh-resource-discovery/query/mesh-query-builder-types";

// ─── Schemas ──────────────────────────────────────────────────────────────────

// Node-owned resource schema: deployments are distributed across mesh nodes
export const deploymentSchema = z.object({
  deploymentId: z.string(),
  nodeId: z.string(), // <-- identifies which mesh node owns this deployment
  serviceId: z.string(),
  projectId: z.string(),
  environment: z.enum(["prod", "staging", "dev"]),
  status: z.enum(["pending", "running", "stopped", "failed"]),
  version: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  replicas: z.number().int().min(0),
  healthy: z.boolean(),
});

// Node-owned resource schema: logs are tied to specific deployments
export const deploymentLogSchema = z.object({
  logId: z.string(),
  deploymentId: z.string(),
  timestamp: z.string(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Global resource schema: projects exist once globally, support subscriptions
export const projectSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  description: z.string(),
  ownerId: z.string(),
  organizationId: z.string(),
  status: z.enum(["active", "archived", "suspended"]),
  createdAt: z.string(),
  updatedAt: z.string(),
  settings: z.object({
    autoDeploy: z.boolean(),
    requireApproval: z.boolean(),
  }),
});

export type Deployment = z.infer<typeof deploymentSchema>;
export type DeploymentLog = z.infer<typeof deploymentLogSchema>;
export type Project = z.infer<typeof projectSchema>;

// Export schemas for external use
export const schemas = {
  deployment: deploymentSchema,
  deploymentLog: deploymentLogSchema,
  project: projectSchema,
} as const;

// ─── Entities ─────────────────────────────────────────────────────────────────

const deployments = meshEntity({
  key: "deployments",
  item: deploymentSchema,
  itemKey: "deploymentId",
  queries: {
    list: meshQuery(
      z.object({
        serviceId: z.string().optional(),
        projectId: z.string().optional(),
        environment: z.enum(["prod", "staging", "dev"] as const).optional(),
        status: z.enum(["pending", "running", "stopped", "failed"] as const).optional(),
      }),
      z.object({
        items: z.array(deploymentSchema),
        total: z.number(),
      })
    ),

    findById: meshQuery(
      z.object({ deploymentId: z.string() }),
      deploymentSchema.nullable()
    ),

    search: meshQuery(
      z.object({
        query: z.string(),
        filters: z.object({
          environment: z.enum(["prod", "staging", "dev"] as const).optional(),
          healthy: z.boolean().optional(),
        }).optional(),
      }),
      z.object({
        items: z.array(deploymentSchema),
        total: z.number(),
      })
    ),
  },
  mutations: {
    create: meshMutation(
      deploymentSchema.omit({ deploymentId: true, createdAt: true, updatedAt: true }),
      deploymentSchema
    ),

    update: meshMutation(
      z.object({
        deploymentId: z.string(),
        updates: deploymentSchema.partial().omit({ deploymentId: true }),
      }),
      deploymentSchema
    ),

    delete: meshMutation(
      z.object({ deploymentId: z.string() }),
      z.object({ success: z.boolean() })
    ),

    restart: meshMutation(
      z.object({
        deploymentId: z.string(),
        graceful: z.boolean().optional(),
      }),
      deploymentSchema
    ),

    scale: meshMutation(
      z.object({
        deploymentId: z.string(),
        replicas: z.number().int().min(0),
      }),
      deploymentSchema
    ),
  },
});

const deploymentLogs = meshEntity({
  key: "deploymentLogs",
  item: deploymentLogSchema,
  itemKey: "logId",
  queries: {
    list: meshQuery(
      z.object({
        deploymentId: z.string(),
        level: z.enum(["debug", "info", "warn", "error"] as const).optional(),
        since: z.string().optional(),
        until: z.string().optional(),
        limit: z.number().int().optional(),
      }),
      z.object({
        items: z.array(deploymentLogSchema),
        hasMore: z.boolean(),
      })
    ),

    stream: meshQuery(
      z.object({
        deploymentId: z.string(),
        follow: z.boolean().optional(),
      }),
      z.object({
        streamId: z.string(),
      })
    ),
  },
  mutations: {
    delete: meshMutation(
      z.object({ deploymentId: z.string(), before: z.string().optional() }),
      z.object({ deleted: z.number() })
    ),
  },
});

// Global resource: projects exist once globally, support subscriptions
const projects = meshEntity({
  key: "projects",
  item: projectSchema,
  itemKey: "projectId",
  config: { scope: "global", subscriptions: true },
  queries: {
    list: meshQuery(
      z.object({
        organizationId: z.string().optional(),
        status: z.enum(["active", "archived", "suspended"] as const).optional(),
        ownerId: z.string().optional(),
      }),
      z.object({
        items: z.array(projectSchema),
        total: z.number(),
      })
    ),

    findById: meshQuery(
      z.object({ projectId: z.string() }),
      projectSchema.nullable()
    ),

    search: meshQuery(
      z.object({
        query: z.string(),
        organizationId: z.string().optional(),
      }),
      z.object({
        items: z.array(projectSchema),   
        total: z.number(),
      })
    ),
  },
  mutations: {
    create: meshMutation(
      projectSchema.omit({ projectId: true, createdAt: true, updatedAt: true }),
      projectSchema
    ),

    update: meshMutation(
      z.object({
        projectId: z.string(),
        updates: projectSchema.partial().omit({ projectId: true }),
      }),
      projectSchema
    ),

    delete: meshMutation(
      z.object({ projectId: z.string() }),
      z.object({ success: z.boolean() })
    ),

    archive: meshMutation(
      z.object({ projectId: z.string() }),
      projectSchema
    ),
  },
});

// ─── Mesh Service ─────────────────────────────────────────────────────────────

/**
 * Example mesh service that exposes deployment-related entities.
 *
 * This service is a distributed query surface — it doesn't contain the actual
 * business logic for managing deployments, but rather provides the mesh
 * interface for querying deployment data from across the cluster.
 */
@Injectable()
export class TestDeploymentMeshService {
  private readonly logger = new Logger(TestDeploymentMeshService.name);

  // Static entity definitions for type-safe discovery
  static readonly entities = {
    deployments,
    deploymentLogs,
    projects,
  } as const;

  // Convenience references for discovery service usage
  static readonly queries = {
    // Node-owned resources
    deployments: deployments.queries.list,
    findDeploymentById: deployments.queries.findById,
    searchDeployments: deployments.queries.search,
    deploymentLogs: deploymentLogs.queries.list,
    // Global resources
    projects: projects.queries.list,
    findProjectById: projects.queries.findById,
    searchProjects: projects.queries.search,
    streamDeploymentLogs: deploymentLogs.queries.stream,
  } as const;

  static readonly mutations = {
    createDeployment: deployments.mutations.create,
    updateDeployment: deployments.mutations.update,
    deleteDeployment: deployments.mutations.delete,
    restartDeployment: deployments.mutations.restart,
    scaleDeployment: deployments.mutations.scale,
    deleteDeploymentLogs: deploymentLogs.mutations.delete,
  } as const;

  // Schemas for external use (e.g., for subscription registration)
  static readonly schemas = {
    deployment: deploymentSchema,
    deploymentLog: deploymentLogSchema,
    project: projectSchema,
  } as const;

  // Instance method handlers would be registered with the mesh infrastructure
  // For this example, we show the type-safe query handlers

  async handleListDeployments(input: {
    serviceId?: string;
    projectId?: string;
    environment?: "prod" | "staging" | "dev";
    status?: "pending" | "running" | "stopped" | "failed";
  }): Promise<{ items: Deployment[]; total: number }> {
    this.logger.log(`Listing deployments with filters: ${JSON.stringify(input)}`);

    // In a real implementation, this would query the local database
    // and return deployment data for this node
    return {
      items: [],
      total: 0,
    };
  }

  async handleFindById(input: { deploymentId: string }): Promise<Deployment | null> {
    this.logger.log(`Finding deployment: ${input.deploymentId}`);
    return null;
  }

  async handleCreateDeployment(input: Omit<Deployment, "deploymentId" | "createdAt" | "updatedAt">): Promise<Deployment> {
    this.logger.log(`Creating deployment for service: ${input.serviceId}`);

    const deployment: Deployment = {
      deploymentId: `dep-${String(Date.now())}`,
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return deployment;
  }

  async handleScaleDeployment(input: { deploymentId: string; replicas: number }): Promise<Deployment> {
    this.logger.log(`Scaling deployment ${input.deploymentId} to ${String(input.replicas)} replicas`);

    // Return mock updated deployment
    return {
      deploymentId: input.deploymentId,
      nodeId: "node-1",
      serviceId: "svc-1",
      projectId: "proj-1",
      environment: "prod",
      status: "running",
      version: "1.0.0",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      replicas: input.replicas,
      healthy: true,
    };
  }
}
