import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { useDescribeSharedApiRuntime } from "@/e2e/utils/shared-api-runtime";
import {
  createDeploymentCompleteStrategyContext,
  type DeploymentCompleteStrategyContext,
} from "./support/deployment-complete-strategy-context";

describe("Deployment strategy e2e: project, service, traefik, config, upload deployment", () => {
  const runtimeScope = useDescribeSharedApiRuntime();
  let context: DeploymentCompleteStrategyContext;

  beforeAll(async () => {
    try {
    context = await createDeploymentCompleteStrategyContext(runtimeScope.getContext());
    } catch (error) {
        console.error("Error creating deployment complete strategy context:", error);
        throw error; // Rethrow to fail the test setup
    }
  });

  it("creates a project and applies typed deployment/security/environment configuration", async () => {
    const project = await context.projectService.createProject({
      ownerId: context.ownerId,
      name: `e2e-project-${randomUUID()}`,
      description: "E2E deployment strategy project",
      baseDomain: "e2e.example.test",
    });

    const deploymentConfig = await context.projectService.updateDeploymentConfig(
      project.id,
      context.ownerId,
      {
        deploymentStrategy: "blue_green",
        requireApprovalForProduction: true,
        healthCheckTimeout: 45,
      },
    );

    const securityConfig = await context.projectService.updateSecurityConfig(
      project.id,
      context.ownerId,
      {
        enableHttpsRedirect: true,
        allowedDomains: ["e2e.example.test", "preview.e2e.example.test"],
      },
    );

    const environmentConfig = await context.projectService.updateEnvironmentConfig(
      project.id,
      context.ownerId,
      {
        defaultEnvironmentVariables: {
          NODE_ENV: "production",
          FEATURE_FLAG_E2E: "true",
        },
      },
    );

    expect(project.ownerId).toBe(context.ownerId);
    expect(deploymentConfig.deploymentStrategy).toBe("blue_green");
    expect(deploymentConfig.requireApprovalForProduction).toBe(true);
    expect(securityConfig.enableHttpsRedirect).toBe(true);
    expect(securityConfig.allowedDomains).toContain("e2e.example.test");
    expect(environmentConfig.defaultEnvironmentVariables?.FEATURE_FLAG_E2E).toBe("true");
  });

  it("creates a service and configures traefik routing metadata", async () => {
    const project = await context.projectService.createProject({
      ownerId: context.ownerId,
      name: `e2e-project-svc-${randomUUID()}`,
      description: "Project for service + traefik setup",
      baseDomain: "services.e2e.example.test",
    });

    const service = await context.serviceService.createService(
      {
        projectId: project.id,
        name: `api-${randomUUID()}`,
        description: "E2E service",
        type: "web",
        providerId: "upload",
        builderId: "dockerfile",
        port: 3000,
        healthCheckPath: "/health",
        customDomains: ["api.services.e2e.example.test"],
      },
      context.ownerId,
    );

    const serviceConfig = await context.traefikService.createServiceConfiguration(service.id, {
      domain: "services.e2e.example.test",
      subdomain: `svc-${service.id.slice(0, 8)}`,
      port: 3000,
      sslEnabled: true,
      sslProvider: "letsencrypt",
      pathPrefix: "/",
      healthCheck: {
        enabled: true,
        path: "/health",
      },
    });

    if (!serviceConfig) {
      throw new Error("Expected Traefik service configuration to be created");
    }

    const validation = await context.traefikService.validateConfiguration(serviceConfig.id);

    expect(service.projectId).toBe(project.id);
    expect(service.providerId).toBe("upload");
    expect(service.builderId).toBe("dockerfile");
    expect(serviceConfig.serviceId).toBe(service.id);
    expect(serviceConfig.fullDomain).toContain("services.e2e.example.test");
    expect(validation.isValid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });

  it("triggers deployment with upload provider and verifies queue + storage/runtime context", async () => {
    const project = await context.projectService.createProject({
      ownerId: context.ownerId,
      name: `e2e-project-deploy-${randomUUID()}`,
      description: "Project for deployment flow",
      baseDomain: "deploy.e2e.example.test",
    });

    const service = await context.serviceService.createService(
      {
        projectId: project.id,
        name: `web-${randomUUID()}`,
        description: "E2E deployment service",
        type: "web",
        providerId: "upload",
        builderId: "dockerfile",
        port: 8080,
      },
      context.ownerId,
    );

    const uploadId = `upload-${randomUUID()}`;
    const deployment = await context.deploymentService.triggerDeployment(
      {
        serviceId: service.id,
        environment: "preview",
        sourceType: "upload",
        sourceConfig: {
          fileName: "bundle.zip",
          fileSize: 1024,
          customData: {
            uploadId,
            uploadPath: "/tmp/e2e-upload/bundle.zip",
            runtimeRunner: "dockerfile",
            containerImage: `ghcr.io/e2e/deploy-${service.id.slice(0, 8)}:latest`,
            runtimeRunnerOptions: {
              containerName: `ctr-${service.id.slice(0, 8)}`,
              networkMode: "bridge",
              healthCheckMaxRetries: 3,
              healthCheckRetryIntervalMs: 1000,
            },
          },
        },
      },
      context.ownerId,
      null,
    );

    expect(deployment.status).toBe("queued");
    expect(deployment.sourceType).toBe("upload");

    const queueJobs = context.deploymentService.listQueueJobs({
      deploymentId: deployment.id,
      status: "queued",
      limit: 20,
      offset: 0,
    });

    const queuedDeployJob = queueJobs.items.find((job) => job.type === "deploy");
    expect(queuedDeployJob).toBeDefined();

    if (!queuedDeployJob) {
      throw new Error("Expected queued deploy job for triggered deployment");
    }

    const contextPayload = queuedDeployJob.payload.context as {
      sourceCheckout?: { provider?: string; uploadId?: string };
      storageBinding?: { storageType?: string; updateStrategy?: string };
      runtimeConfiguration?: { deployment?: { strategy?: string } };
    };

    expect(contextPayload.sourceCheckout?.provider).toBe("upload");
    expect(contextPayload.sourceCheckout?.uploadId).toBe(uploadId);
    expect(contextPayload.storageBinding?.storageType).toBe("local");
    expect(contextPayload.storageBinding?.updateStrategy).toBe("manual_update_button");
    expect(typeof contextPayload.runtimeConfiguration?.deployment?.strategy).toBe("string");

    const claimed = await context.deploymentService.claimQueueJobByIdempotencyKey(
      `deploy:${deployment.id}:trigger`,
      {
        workerId: context.workerId,
        types: ["deploy"],
        limit: 1,
        leaseDurationSec: 120,
      },
    );

    expect(claimed).not.toBeNull();
    if (!claimed?.lockToken) {
      throw new Error("Expected claimed deployment queue job with lock token");
    }

    const completed = await context.deploymentService.completeQueueJob(claimed.id, {
      workerId: context.workerId,
      lockToken: claimed.lockToken,
      result: {
        outcome: "e2e-upload-deploy-finished",
      },
    });

    expect(completed.updated).toBe(true);
    expect(completed.job.status).toBe("succeeded");
  });

  it("compiles preview deployment plan with routing and tls lifecycle nodes", () => {
    const serviceId = randomUUID();
    const projectId = randomUUID();

    const compileResult = context.deploymentService.compilePlan({
      serviceId,
      projectId,
      environment: "preview",
      templateRefs: {},
      context: {
        testCase: "complete-deployment-strategy",
      },
      includeRollbackEdges: true,
      strict: true,
    });

    const nodeTypes = new Set(compileResult.plan.nodes.map((node) => node.type));
    const rollbackEdges = compileResult.plan.edges.filter((edge) => edge.kind === "rollback");

    expect(compileResult.compiled).toBe(true);
    expect(nodeTypes.has("preview_name")).toBe(true);
    expect(nodeTypes.has("route_provision")).toBe(true);
    expect(nodeTypes.has("tls_provision")).toBe(true);
    expect(nodeTypes.has("health")).toBe(true);
    expect(rollbackEdges.length).toBeGreaterThan(0);
  });

  it("compiles production deployment plan without rollback edges when disabled", () => {
    const serviceId = randomUUID();
    const projectId = randomUUID();

    const compileResult = context.deploymentService.compilePlan({
      serviceId,
      projectId,
      environment: "production",
      templateRefs: {},
      context: {
        testCase: "complete-deployment-strategy-production-no-rollback",
      },
      includeRollbackEdges: false,
      strict: false,
    });

    const rollbackEdges = compileResult.plan.edges.filter((edge) => edge.kind === "rollback");

    expect(compileResult.compiled).toBe(true);
    expect(compileResult.plan.nodes.length).toBeGreaterThan(0);
    expect(compileResult.plan.edges.length).toBeGreaterThan(0);
    expect(rollbackEdges).toHaveLength(0);
  });

  it("lists queued deployment jobs using deployment + type + status filters", async () => {
    const project = await context.projectService.createProject({
      ownerId: context.ownerId,
      name: `e2e-project-filter-${randomUUID()}`,
      description: "Project for queue listing filters",
      baseDomain: "filter.e2e.example.test",
    });

    const service = await context.serviceService.createService(
      {
        projectId: project.id,
        name: `svc-filter-${randomUUID()}`,
        description: "Service for queue listing filters",
        type: "web",
        providerId: "upload",
        builderId: "dockerfile",
        port: 3000,
      },
      context.ownerId,
    );

    const deployment = await context.deploymentService.triggerDeployment(
      {
        serviceId: service.id,
        environment: "preview",
        sourceType: "upload",
        sourceConfig: {
          fileName: "bundle-filter.zip",
          fileSize: 2048,
          customData: {
            uploadId: `upload-filter-${randomUUID()}`,
            uploadPath: "/tmp/e2e-upload/bundle-filter.zip",
            runtimeRunner: "dockerfile",
            containerImage: `ghcr.io/e2e/filter-${service.id.slice(0, 8)}:latest`,
          },
        },
      },
      context.ownerId,
      null,
    );

    const filtered = context.deploymentService.listQueueJobs({
      deploymentId: deployment.id,
      type: "deploy",
      status: "queued",
      limit: 20,
      offset: 0,
    });

    expect(filtered.items.length).toBeGreaterThanOrEqual(1);
    expect(filtered.items.some((job) => job.payload.deploymentId === deployment.id)).toBe(true);
    expect(filtered.items.every((job) => job.type === "deploy")).toBe(true);
    expect(filtered.items.every((job) => job.status === "queued")).toBe(true);
  });
});
