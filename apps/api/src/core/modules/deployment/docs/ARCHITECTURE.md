# Deployment Module Architecture

> **Last Updated**: 2025-11-30

## System Overview

The Deployment module is the central orchestration layer for all deployment operations:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     CoreDeploymentModule                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   ORCHESTRATION LAYER                        │   │
│  │                                                              │   │
│  │  DeploymentOrchestrator ◄──── Entry point for deployments   │   │
│  │      │                                                       │   │
│  │      ├── Uses providers to fetch source code                 │   │
│  │      ├── Uses builders to build applications                 │   │
│  │      └── Manages deployment lifecycle                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│         ┌────────────────────┼────────────────────┐                 │
│         ▼                    ▼                    ▼                 │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐           │
│  │ Deployment  │     │  Rules      │     │  Strategy   │           │
│  │ Service     │     │  Engine     │     │  Executor   │           │
│  └─────────────┘     └─────────────┘     └─────────────┘           │
│         │                    │                    │                 │
│         │                    ▼                    │                 │
│         │           ┌─────────────┐               │                 │
│         │           │   Health    │               │                 │
│         │           │   Monitor   │               │                 │
│         │           └─────────────┘               │                 │
│         │                    │                    │                 │
│         └────────────────────┼────────────────────┘                 │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    REPOSITORY LAYER                          │   │
│  │                  DeploymentRepository                        │   │
│  │  (All database operations go through this layer)             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    DATABASE LAYER                            │   │
│  │              PostgreSQL via Drizzle ORM                      │   │
│  │  Tables: deployments, deployment_logs, services              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. DeploymentOrchestrator (Entry Point)

**Role**: Unified deployment pipeline that coordinates providers, builders, and deployment execution.

```typescript
@Injectable()
export class DeploymentOrchestrator {
  // Main orchestration
  orchestrateDeployment(options: OrchestrationOptions): Promise<OrchestrationResult>
  
  // Provider management
  getProviderForSource(sourceType: string): IDeploymentProvider
  
  // Status updates
  updateDeploymentStatus(deploymentId: string, status: DeploymentStatus): Promise<void>
}
```

**Responsibilities**:
- Select appropriate provider based on source type
- Fetch source code via provider
- Select appropriate builder based on project type
- Execute build process
- Deploy to container infrastructure
- Monitor deployment health

---

### 2. DeploymentService (Core Logic)

**Role**: Core deployment lifecycle management with database operations.

```typescript
@Injectable()
export class DeploymentService {
  // Deployment CRUD
  createDeployment(data: CreateDeploymentData): Promise<SelectDeployment>
  getDeployment(id: string): Promise<SelectDeployment | null>
  getDeploymentsByService(serviceId: string, limit?: number): Promise<SelectDeployment[]>
  updateDeploymentStatus(id: string, status: DeploymentStatus): Promise<void>
  
  // Execution
  executeDeployment(deploymentId: string): Promise<void>
  cancelDeployment(deploymentId: string): Promise<void>
  rollbackDeployment(deploymentId: string): Promise<void>
  
  // Logging
  addDeploymentLog(deploymentId: string, log: DeploymentLogData): Promise<void>
  getDeploymentLogs(deploymentId: string): Promise<SelectDeploymentLog[]>
  
  // Phase management
  updateDeploymentPhase(deploymentId: string, phase: DeploymentPhase): Promise<void>
  
  // Container operations
  getDeploymentContainers(deploymentId: string): Promise<ContainerInfo[]>
  stopDeploymentContainers(deploymentId: string): Promise<void>
}
```

---

### 3. DeploymentRulesService

**Role**: Basic deployment rule evaluation.

```typescript
@Injectable()
export class DeploymentRulesService {
  evaluateRules(deployment: Deployment, rules: Rule[]): RuleResult
  matchEnvironment(deployment: Deployment, rule: EnvironmentRule): boolean
  matchBranch(deployment: Deployment, rule: BranchRule): boolean
}
```

---

### 4. EnhancedDeploymentRulesService

**Role**: Advanced rule matching with custom conditions.

```typescript
@Injectable()
export class EnhancedDeploymentRulesService {
  // Rule evaluation
  evaluateEnhancedRules(context: RuleContext, rules: EnhancedRule[]): RuleResult
  
  // Condition evaluation
  evaluateConditions(context: RuleContext, conditions: Condition[]): boolean
  evaluateCustomCondition(context: RuleContext, condition: CustomCondition): boolean
}
```

---

### 5. DeploymentStrategyExecutor

**Role**: Execute deployment strategies (rolling, blue-green, canary).

```typescript
@Injectable()
export class DeploymentStrategyExecutor {
  // Strategy execution
  executeStrategy(deployment: Deployment, strategy: DeploymentStrategy): Promise<void>
  
  // Strategy types
  executeRolling(deployment: Deployment, config: RollingConfig): Promise<void>
  executeBlueGreen(deployment: Deployment, config: BlueGreenConfig): Promise<void>
  executeCanary(deployment: Deployment, config: CanaryConfig): Promise<void>
  
  // Rollback
  rollbackStrategy(deployment: Deployment): Promise<void>
}
```

---

### 6. DeploymentHealthMonitorService

**Role**: Monitor active deployments and report health status.

```typescript
@Injectable()
export class DeploymentHealthMonitorService {
  // Scheduled monitoring
  @Cron('*/30 * * * * *')
  monitorActiveDeployments(): Promise<void>
  
  // Health checks
  checkDeploymentHealth(deploymentId: string): Promise<HealthStatus>
  getHealthHistory(deploymentId: string): Promise<HealthRecord[]>
  
  // Alerts
  handleUnhealthyDeployment(deploymentId: string): Promise<void>
}
```

---

### 7. DeploymentCleanupService

**Role**: Automated cleanup of old/orphaned deployments.

```typescript
@Injectable()
export class DeploymentCleanupService {
  // Scheduled cleanup
  @Cron('0 0 * * *') // Daily
  cleanupOldDeployments(): Promise<void>
  
  // Manual cleanup
  cleanupDeployment(deploymentId: string): Promise<void>
  cleanupOrphanedContainers(): Promise<void>
  cleanupOrphanedImages(): Promise<void>
}
```

---

### 8. PreviewDeploymentService

**Role**: Manage preview/PR deployments with automatic lifecycle.

```typescript
@Injectable()
export class PreviewDeploymentService {
  // Preview management
  createPreviewDeployment(prNumber: number, config: PreviewConfig): Promise<Deployment>
  updatePreviewDeployment(prNumber: number): Promise<Deployment>
  deletePreviewDeployment(prNumber: number): Promise<void>
  
  // PR lifecycle
  handlePROpened(webhook: PRWebhook): Promise<void>
  handlePRUpdated(webhook: PRWebhook): Promise<void>
  handlePRClosed(webhook: PRWebhook): Promise<void>
}
```

---

### 9. CustomConditionRegistry

**Role**: Registry for custom deployment conditions.

```typescript
@Injectable()
export class CustomConditionRegistry {
  register(name: string, evaluator: ConditionEvaluator): void
  get(name: string): ConditionEvaluator | undefined
  evaluate(name: string, context: RuleContext): boolean
}
```

---

### 10. Provider-Specific Rule Matchers (Feature Modules)

**Role**: Pattern matching for deployment rules is now handled by **provider-specific services** in feature modules, not in the core deployment module.

**Architecture Decision**: The core deployment module is provider-agnostic. Provider-specific rule matching logic (e.g., matching GitHub events to deployment rules) has been moved to feature modules.

**Example - GitHub Rule Matcher**:

```typescript
// Location: src/modules/github/services/github-rule-matcher.service.ts
@Injectable()
export class GitHubRuleMatcherService {
  findMatchesForEvent(event: NormalizedGitHubEvent): Promise<DeploymentRuleMatch[]>
}
```

**Generic Types (Core Module)**:

```typescript
// Location: src/core/modules/deployment/types/deployment-trigger.types.ts
interface DeploymentTriggerEvent {
  sourceType: DeploymentSourceType;
  eventType: DeploymentEventType;
  repository: DeploymentSourceRepository;
  // ... provider-agnostic fields
}

interface DeploymentRuleMatch {
  rule: { id: string; name: string; /* ... */ };
  service: { id: string; name: string; projectId: string; /* ... */ };
  deploymentConfig: { branch?: string; environment: string; /* ... */ };
  changedFiles: string[];
}
```

---

## Data Flow

### Deployment Creation Flow

```
1. Client calls DeploymentOrchestrator.orchestrateDeployment()
   │
2. Create deployment record (status: QUEUED)
   │  └── DeploymentRepository.create()
   │
3. Select provider based on sourceType
   │  └── ProviderRegistry.getProvider(sourceType)
   │
4. Fetch source code
   │  ├── Provider.fetchSource()
   │  └── Update status: FETCHING
   │
5. Analyze project type
   │  └── Detect Dockerfile, package.json, etc.
   │
6. Select builder based on project type
   │  └── BuilderRegistry.getBuilder(buildType)
   │
7. Build application
   │  ├── Builder.build()
   │  └── Update status: BUILDING
   │
8. Deploy to infrastructure
   │  ├── Create container
   │  ├── Configure Traefik routes
   │  └── Update status: DEPLOYING
   │
9. Health check
   │  ├── Wait for container healthy
   │  └── Update status: ACTIVE or FAILED
   │
10. Cleanup
    └── Remove temporary build files
```

### Provider Selection Flow

```
1. Get source type from deployment config
   │
2. Query ProviderRegistry
   │  └── for provider in providers:
   │        if provider.supports(config):
   │          return provider
   │
3. Provider fetches source
   │  ├── GitHub: Clone via git, authenticate with GitHub App
   │  ├── Static: Copy uploaded files
   │  └── GitLab: Clone via git, authenticate with OAuth
   │
4. Return source path to orchestrator
```

### Builder Selection Flow

```
1. Analyze source directory
   │  ├── Has Dockerfile? → dockerfile builder
   │  ├── Has package.json? → node builder
   │  ├── Has requirements.txt? → python builder
   │  └── Static HTML only? → static builder
   │
2. Query BuilderRegistry
   │  └── for builder in builders:
   │        if builder.supports(config):
   │          return builder
   │
3. Builder builds application
   │  ├── Dockerfile: docker build
   │  ├── Nixpack: nixpacks build
   │  ├── Buildpack: pack build
   │  └── Static: copy to serve directory
   │
4. Return image tag to orchestrator
```

---

## Deployment Status Flow

```
                        ┌──────────────────────┐
                        │       QUEUED         │
                        │   (Initial state)    │
                        └──────────┬───────────┘
                                   │
                                   ▼
                        ┌──────────────────────┐
                        │      FETCHING        │
                        │ (Getting source code)│
                        └──────────┬───────────┘
                                   │
                          ┌────────┴────────┐
                          │                 │
                          ▼                 ▼
               ┌──────────────────┐  ┌──────────────────┐
               │    BUILDING      │  │     FAILED       │
               │ (Building image) │  │ (Fetch failed)   │
               └────────┬─────────┘  └──────────────────┘
                        │
               ┌────────┴────────┐
               │                 │
               ▼                 ▼
    ┌──────────────────┐  ┌──────────────────┐
    │    DEPLOYING     │  │     FAILED       │
    │(Creating container)│ │ (Build failed)   │
    └────────┬─────────┘  └──────────────────┘
             │
    ┌────────┴────────┐
    │                 │
    ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│     ACTIVE       │  │     FAILED       │
│(Running, healthy)│  │(Deploy failed)   │
└────────┬─────────┘  └──────────────────┘
         │
         ├──────────────────┐
         │                  │
         ▼                  ▼
┌──────────────────┐  ┌──────────────────┐
│    STOPPING      │  │   SUPERSEDED     │
│(Being stopped)   │  │(New deploy active)│
└────────┬─────────┘  └──────────────────┘
         │
         ▼
┌──────────────────┐
│    STOPPED       │
│(Manually stopped)│
└──────────────────┘
```

---

## Database Schema

### deployments

```sql
CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  
  -- Source
  source_type source_type_enum NOT NULL,
  source_config JSONB NOT NULL,
  
  -- Status
  status deployment_status_enum NOT NULL DEFAULT 'queued',
  phase deployment_phase_enum,
  phase_metadata JSONB,
  
  -- Execution
  triggered_by TEXT,
  environment TEXT NOT NULL DEFAULT 'production',
  
  -- Results
  container_id TEXT,
  image_tag TEXT,
  domain TEXT,
  port INTEGER,
  
  -- Timing
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  error_message TEXT
);
```

### deployment_logs

```sql
CREATE TABLE deployment_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  
  level log_level_enum NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  phase TEXT,
  step TEXT,
  service TEXT,
  stage TEXT,
  
  timestamp TIMESTAMP NOT NULL DEFAULT now(),
  metadata JSONB DEFAULT '{}'
);

CREATE INDEX deployment_logs_deployment_idx ON deployment_logs(deployment_id);
CREATE INDEX deployment_logs_timestamp_idx ON deployment_logs(timestamp);
```

---

## Dependency Graph

```
                    CoreDeploymentModule
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
    ProvidersModule  BuildersModule  TraefikCoreModule
          │                │                │
          ▼                ▼                ▼
    GitHubProvider   DockerfileBuilder  TraefikService
    StaticProvider   NixpackBuilder     VariableResolver
                     BuildpackBuilder
                     StaticBuilder
                           │
                           ▼
                     DockerModule (@Global)
                           │
                           ▼
                     DockerService
```

### Service Dependencies

```
DeploymentOrchestrator
├── DeploymentService
├── ProviderRegistryService
├── BuilderRegistryService
├── DockerService (from global)
└── TraefikService

DeploymentService
├── DeploymentRepository
├── ServiceRepository
├── DockerService (from global)
└── ProviderRegistryService

DeploymentHealthMonitorService
├── DeploymentService
├── DockerService
└── DeploymentRepository

DeploymentCleanupService
├── DeploymentService
├── DockerService
└── DeploymentRepository
```

---

## Integration Points

### With TraefikModule

When a deployment becomes active, Traefik configuration is updated:

```typescript
// In DeploymentOrchestrator
async finalizeDeployment(deployment: Deployment, containerInfo: ContainerInfo) {
  // Create Traefik route
  await this.traefikService.createServiceConfiguration({
    serviceId: deployment.serviceId,
    domain: containerInfo.domain,
    targetContainer: containerInfo.containerId,
    port: containerInfo.port,
    sslEnabled: true,
  });
}
```

### With ProvidersModule

Source code is fetched through providers:

```typescript
// In DeploymentOrchestrator
async fetchSource(deployment: Deployment) {
  const provider = this.providerRegistry.getProvider(deployment.sourceType);
  const result = await provider.fetchSource(deployment.sourceConfig, deployment.id);
  return result.sourcePath;
}
```

### With BuildersModule

Applications are built through builders:

```typescript
// In DeploymentOrchestrator
async buildApplication(deployment: Deployment, sourcePath: string) {
  const builder = this.builderRegistry.getBuilder(deployment.buildType);
  const result = await builder.build({
    sourcePath,
    deploymentId: deployment.id,
    ...deployment.buildConfig,
  });
  return result.imageTag;
}
```

---

## Error Handling

### Deployment Errors

```typescript
// Errors flow through DeploymentService
try {
  await this.orchestrator.orchestrateDeployment(options);
} catch (error) {
  // Update deployment status
  await this.deploymentService.updateDeploymentStatus(deploymentId, 'failed');
  
  // Log error
  await this.deploymentService.addDeploymentLog(deploymentId, {
    level: 'error',
    message: error.message,
    phase: currentPhase,
  });
  
  // Cleanup partial resources
  await this.cleanupFailedDeployment(deploymentId);
  
  throw error;
}
```

### Error Recovery

```typescript
// Automatic retry for transient failures
const retryablePhases = ['fetching', 'building'];

if (retryablePhases.includes(currentPhase) && retryCount < maxRetries) {
  await this.scheduleRetry(deploymentId, retryCount + 1);
}
```

---

## Security Considerations

1. **Source Code Access**
   - GitHub App tokens for private repos
   - Token rotation and expiration
   - Audit logging for source access

2. **Container Isolation**
   - Each deployment in isolated container
   - Resource limits enforced
   - Network policies applied

3. **Secrets Management**
   - Environment variables encrypted at rest
   - Secrets injected at runtime
   - No secrets in logs

4. **Audit Trail**
   - All deployment actions logged
   - Triggered-by tracking
   - Deployment history retained
