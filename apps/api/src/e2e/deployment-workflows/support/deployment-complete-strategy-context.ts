import { randomUUID } from "node:crypto";
import type { SharedApiRuntimeContext } from "@/e2e/utils/shared-api-runtime";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { ProjectService } from "@/modules/project/services/project.service";
import { ServiceService } from "@/modules/service/services/service.service";
import { DeploymentService } from "@/modules/deployment/services/deployment.service";
import { TraefikService } from "@/core/modules/traefik/services/traefik.service";
import { user } from "@/config/drizzle/global/schema/auth";

export interface DeploymentCompleteStrategyContext {
  ownerId: string;
  workerId: string;
  projectService: ProjectService;
  serviceService: ServiceService;
  deploymentService: DeploymentService;
  traefikService: TraefikService;
}

async function seedTestOwner(databaseService: GlobalDatabaseService): Promise<string> {
  const ownerId = `e2e-owner-${randomUUID()}`;
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

  return ownerId;
}

export async function createDeploymentCompleteStrategyContext(
  context: SharedApiRuntimeContext,
): Promise<DeploymentCompleteStrategyContext> {
  const databaseService = context.serviceMapper.get(GlobalDatabaseService);
  const ownerId = await seedTestOwner(databaseService);

  return {
    ownerId,
    workerId: `e2e-worker-${randomUUID()}`,
    projectService: context.serviceMapper.get(ProjectService),
    serviceService: context.serviceMapper.get(ServiceService),
    deploymentService: context.serviceMapper.get(DeploymentService),
    traefikService: context.serviceMapper.get(TraefikService),
  };
}