import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { DeploymentService } from './services/deployment.service';
import { DeploymentRepository } from './repositories/deployment.repository';
import { DeploymentCleanupService } from './services/deployment-cleanup.service';
import { DeploymentHealthMonitorService } from './services/deployment-health-monitor.service';
import { DeploymentRulesService } from './services/deployment-rules.service';
import { DeploymentOrchestrator } from './services/deployment-orchestrator.service';
import { EnhancedDeploymentRulesService } from './services/enhanced-deployment-rules.service';
import { DeploymentStrategyExecutor } from './services/deployment-strategy-executor.service';
import { PreviewDeploymentService } from './services/preview-deployment.service';
import { CustomConditionRegistry } from './services/custom-condition-registry.service';
import { RuleMatcherService } from './services/rule-matcher.service';
import { GithubProviderService } from '../providers/github/github-provider.service';
import { StaticProviderService } from '../providers/static/static-provider.service';
import { BuildersModule } from '../builders/builders.module';
import { ProvidersModule } from '../providers/providers.module';
import { GitHubProviderModule } from '../providers/github/github-provider.module';
import { StaticProviderModule } from '../providers/static/static-provider.module';
import { TraefikCoreModule } from '../traefik/traefik.module';

/**
 * CORE MODULE: Deployment
 * Provides deployment infrastructure services
 * 
 * This is a CORE module - it provides deployment-related infrastructure services.
 * 
 * Services exported:
 * - DeploymentService: Deployment lifecycle management (uses provider/builder registries)
 * - DeploymentCleanupService: Automated cleanup of old deployments
 * - DeploymentHealthMonitorService: Health monitoring for deployments
 * - DeploymentOrchestrator: Unified deployment pipeline with provider abstraction
 * 
 * Dependencies:
 * - DockerModule: Docker service for container operations (forwardRef due to CoreModule aggregation)
 * - ScheduleModule: For cron jobs in DeploymentHealthMonitorService
 * - GitHubProviderModule: GitHub provider for deployments
 * - StaticProviderModule: Static files provider for deployments
 * - ProvidersModule: Provider registry for accessing providers
 * - BuildersModule: Builder registry for accessing builders
 * - TraefikCoreModule: Traefik configuration and variable resolution
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    GitHubProviderModule,
    StaticProviderModule,
    ProvidersModule,
    BuildersModule,
    TraefikCoreModule,
    // DockerModule not imported - it's @Global() and imported in CoreModule
  ],
  providers: [
    DeploymentRepository, // Repository layer - handles ALL database access
    DeploymentService,
    DeploymentCleanupService,
    DeploymentHealthMonitorService,
    DeploymentRulesService,
    EnhancedDeploymentRulesService,
    CustomConditionRegistry,
    RuleMatcherService,
    DeploymentStrategyExecutor,
    PreviewDeploymentService,
    DeploymentOrchestrator,
    // Provider array for DeploymentOrchestrator
    {
      provide: 'DEPLOYMENT_PROVIDERS',
      useFactory: (
        githubProvider: GithubProviderService,
        staticProvider: StaticProviderService,
      ) => {
        return [githubProvider, staticProvider];
      },
      inject: [GithubProviderService, StaticProviderService],
    },
  ],
  exports: [
    DeploymentRepository, // Export for use in other core/feature modules
    DeploymentService,
    DeploymentCleanupService,
    DeploymentHealthMonitorService,
    DeploymentRulesService,
    EnhancedDeploymentRulesService,
    CustomConditionRegistry,
    RuleMatcherService,
    DeploymentStrategyExecutor,
    PreviewDeploymentService,
    DeploymentOrchestrator,
  ],
})
export class CoreDeploymentModule {}
