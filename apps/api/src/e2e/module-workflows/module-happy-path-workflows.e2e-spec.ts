import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import {
  getSharedApiRuntimeContext,
  type SharedApiRuntimeContext,
} from "@/e2e/utils/shared-api-runtime";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { user } from "@/config/drizzle/global/schema/auth";
import { UserService } from "@/modules/user/services/user.service";
import { ProviderSchemaService } from "@/modules/provider-schema/services/provider-schema.service";
import { AnalyticsService } from "@/modules/analytics/services/analytics.service";
import { ProjectService } from "@/modules/project/services/project.service";
import { ServiceService } from "@/modules/service/services/service.service";

describe("Module happy-path workflows e2e: service-level authenticated flows", () => {
  let runtime: SharedApiRuntimeContext;
  let ownerId: string;
  let userService: UserService;
  let providerSchemaService: ProviderSchemaService;
  let analyticsService: AnalyticsService;
  let projectService: ProjectService;
  let serviceService: ServiceService;

  beforeAll(async () => {
    runtime = await getSharedApiRuntimeContext();
    userService = runtime.serviceMapper.get(UserService);
    providerSchemaService = runtime.serviceMapper.get(ProviderSchemaService);
    analyticsService = runtime.serviceMapper.get(AnalyticsService);
    projectService = runtime.serviceMapper.get(ProjectService);
    serviceService = runtime.serviceMapper.get(ServiceService);

    ownerId = `e2e-owner-${randomUUID()}`;
    const databaseService = runtime.serviceMapper.get(GlobalDatabaseService);
    const now = new Date();
    await databaseService.db.insert(user).values({
      id: ownerId,
      name: "E2E Owner",
      email: `${ownerId}@example.test`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
      role: "admin",
    });
  });

  it("creates, updates, and deletes a user", async () => {
    const email = `e2e-user-${randomUUID()}@example.test`;
    const created = await userService.createUser({
      name: "Module E2E User",
      email,
      image: null,
    });

    expect(created).not.toBeNull();
    if (!created) {
      throw new Error("Expected created user to be non-null");
    }

    const fetched = await userService.getUserById(created.id);
    expect(fetched.email).toBe(email);

    const updated = await userService.updateUser(created.id, {
      name: "Module E2E User Updated",
    });
    expect(updated?.name).toBe("Module E2E User Updated");

    const deleted = await userService.deleteUser(created.id);
    expect(deleted?.id).toBe(created.id);
  });

  it("returns paginated user collections", async () => {
    const users = await userService.getUsers({
      limit: 20,
      offset: 0,
    });

    expect(Array.isArray(users.data)).toBe(true);
    expect(users.meta.limit).toBe(20);
  });

  it("creates and updates project + service for an authenticated owner", async () => {
    const project = await projectService.createProject({
      ownerId,
      name: `e2e-happy-project-${randomUUID()}`,
      description: "Happy-path module test project",
      baseDomain: "happy.modules.e2e.example.test",
    });

    const updatedProject = await projectService.updateProject(
      project.id,
      ownerId,
      {
        description: "Happy-path module test project updated",
      },
    );

    expect(updatedProject.description).toBe("Happy-path module test project updated");

    const service = await serviceService.createService(
      {
        projectId: project.id,
        name: `happy-service-${randomUUID()}`,
        description: "Happy-path service",
        type: "application",
        providerId: "artifact-bundle",
        builderId: "manual",
        port: 3001,
        healthCheckPath: "/health",
      },
      ownerId,
    );

    const updatedService = await serviceService.updateService(
      service.id,
      {
        description: "Happy-path service updated",
        healthCheckPath: "/ready",
      },
      ownerId,
    );

    expect(updatedService.description).toBe("Happy-path service updated");
    expect(updatedService.healthCheckPath).toBe("/ready");

    const toggled = await serviceService.toggleActive(
      service.id,
      false,
      ownerId,
    );

    expect(toggled.isActive).toBe(false);
  });

  it("serves provider + builder catalogs with compatibility", async () => {
    const providers = providerSchemaService.getAllProviders();
    const builders = providerSchemaService.getAllBuilders();

    expect(providers.length).toBeGreaterThan(0);
    expect(builders.length).toBeGreaterThan(0);

    const firstProvider = providers[0];
    const firstBuilder = builders[0];

    if (!firstProvider || !firstBuilder) {
      throw new Error("Expected provider and builder catalogs to be non-empty");
    }

    const providerSchema = providerSchemaService.getProviderSchema(firstProvider.id);
    const builderSchema = providerSchemaService.getBuilderSchema(firstBuilder.id);

    expect(providerSchema).toBeDefined();
    expect(builderSchema).toBeDefined();

    const compatibleBuilders = providerSchemaService.getCompatibleBuilders(firstProvider.id);
    const compatibleProviders = providerSchemaService.getCompatibleProviders(firstBuilder.id);

    expect(Array.isArray(compatibleBuilders)).toBe(true);
    expect(Array.isArray(compatibleProviders)).toBe(true);
  });

  it("returns provider and builder validation result envelopes", async () => {
    const firstProvider = providerSchemaService.getAllProviders()[0];
    const firstBuilder = providerSchemaService.getAllBuilders()[0];

    if (!firstProvider || !firstBuilder) {
      throw new Error("Expected provider and builder catalogs to be non-empty");
    }

    const providerValidation = providerSchemaService.validateProviderConfig(
      firstProvider.id,
      {},
    );
    const builderValidation = providerSchemaService.validateBuilderConfig(
      firstBuilder.id,
      {},
    );

    expect(typeof providerValidation.valid).toBe("boolean");
    expect(Array.isArray(providerValidation.errors)).toBe(true);
    expect(typeof builderValidation.valid).toBe("boolean");
    expect(Array.isArray(builderValidation.errors)).toBe(true);
  });

  it("returns analytics metrics collections and report lifecycle shapes", async () => {
    const resourceMetrics = await analyticsService.getResourceMetrics("24h", "hour");
    const deploymentMetrics = await analyticsService.getDeploymentMetrics("7d", "day");
    const realtime = await analyticsService.getRealTimeMetrics(["api", "cache"]);

    expect(resourceMetrics.timeRange).toBe("24h");
    expect(resourceMetrics.data.length).toBe(24);
    expect(deploymentMetrics.data.length).toBe(7);
    expect(realtime.services.length).toBe(2);

    const report = await analyticsService.generateReport({
      period: {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000),
        end: new Date(),
      },
    });

    expect(report.reportId).toContain("report-");
    expect(report.status).toBe("completed");

    const reportStatus = await analyticsService.getReport(report.reportId);
    expect(reportStatus.id).toBe(report.reportId);
    expect(typeof reportStatus.generatedAt).toBe("object");
  });
});