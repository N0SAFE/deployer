import { Module } from '@nestjs/common';
import { DockerModule } from '@/core/modules/docker/docker.module';
import { CoreDeploymentModule } from '@/core/modules/deployment/deployment.module';
import { ProjectsModule } from '@/core/modules/projects/projects.module';
import { OrchestrationModule } from '@/core/modules/orchestration/orchestration.module';
import { ProvidersModule } from '@/core/modules/providers';
import { BuildersModule } from '@/core/modules/builders';
import { DatabaseModule } from '@/core/modules/database/database.module';
import { GitHubModule } from '@/core/modules/github/github.module';
import { CoreStorageModule } from '@/core/modules/storage/storage.module';
import { ServiceModule } from '@/core/modules/service/service.module';
import { ConstantsModule } from '@/core/modules/constants/constants.module';
import { TraefikCoreModule } from '@/core/modules/traefik/traefik.module';
import { ContextModule } from '@/core/modules/context/context.module';
import { DomainModule } from '@/core/modules/domain/domain.module';
import { IdentifierResolverModule } from '@/core/modules/identifier-resolver/identifier-resolver.module';

/**
 * CORE MODULE: Core Services
 * Re-exports fundamental infrastructure services from specialized modules
 * 
 * This is a CORE module - it aggregates other CORE modules for convenience.
 * Feature modules can import CoreModule to get access to all core services.
 * 
 * Module Structure:
 * - DockerModule: Docker service and zombie cleanup
 * - ServiceModule: Service CRUD operations and dependency management
 * - GitService: Provided directly in OrchestrationModule (not a separate module to avoid conflicts)
 * - ProvidersModule: Deployment providers (GitHub, Static, etc.) - before DeploymentModule
 * - DeploymentModule: Deployment lifecycle, cleanup, and health monitoring
 * - ProjectsModule: Project server management
 * - OrchestrationModule: Traefik, Bull queues, deployment processing
 * - DomainModule: Multi-level domain management (organization → project → service)
 * - IdentifierResolverModule: Shared identifier resolution (slugs/names → UUIDs)
 */
@Module({
  imports: [
    DatabaseModule,
    DockerModule,
    GitHubModule,
    ServiceModule,
    BuildersModule,
    CoreStorageModule,
    ContextModule, // Add before other modules that may use it
    DomainModule, // Add before modules that need domain management
    TraefikCoreModule, // Add before ProjectsModule (ProjectsModule depends on it)
    IdentifierResolverModule, // Shared identifier resolution logic
    ProjectsModule,
    OrchestrationModule,
    ProvidersModule,
    CoreDeploymentModule,
    ConstantsModule,
  ],
  exports: [
    DatabaseModule,
    DockerModule,
    GitHubModule,
    ServiceModule,
    BuildersModule,
    CoreStorageModule,
    ContextModule,
    DomainModule,
    TraefikCoreModule,
    IdentifierResolverModule,
    ProjectsModule,
    OrchestrationModule,
    ProvidersModule,
    CoreDeploymentModule,
    ConstantsModule,
  ],
})
export class CoreModule {}
