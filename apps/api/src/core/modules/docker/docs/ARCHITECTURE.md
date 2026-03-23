# Docker Module Architecture

> **Last Updated**: 2025-11-30

## ⚠️ CRITICAL: Architecture Issues and Migration Plan

### Current Architecture (PROBLEMATIC)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DockerModule (@Global)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     SERVICE LAYER                            │   │
│  │  DockerService           ZombieCleanupService               │   │
│  │  (Infrastructure)        (Cleanup Logic)                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              │ ⚠️ INVERTED DEPENDENCIES             │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │               PROBLEMATIC IMPORTS                            │   │
│  │  - CoreDeploymentModule (ZombieCleanupService needs it)      │   │
│  │  - ProjectModule (ZombieCleanupService needs it)             │   │
│  │  - ServiceModule (ZombieCleanupService needs it)             │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why This Is Wrong:**
1. Docker is a **foundation layer** - it should not know about business concepts (deployments, projects, services)
2. This creates **circular dependency risk** with forwardRef
3. Makes **testing difficult** - can't test Docker in isolation
4. **Violates Single Responsibility Principle** - Docker module does cleanup logic

---

## Target Architecture (CLEAN)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DockerModule (@Global)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                     SERVICE LAYER                            │   │
│  │                     DockerService                            │   │
│  │  (Pure Docker infrastructure operations only)                │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                  EXTERNAL DEPENDENCY                         │   │
│  │                    dockerode                                 │   │
│  │  (Docker API client)                                         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

                              │
                              │ Other modules import DockerModule
                              ▼

┌─────────────────────────────────────────────────────────────────────┐
│                     CleanupModule (NEW)                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    ZombieCleanupService                      │   │
│  │  (Moved from Docker module)                                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
│         │                    │                    │                 │
│         ▼                    ▼                    ▼                 │
│   DockerService      DeploymentService     ProjectService          │
│    (injected)          (injected)          (injected)              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## System Overview (Target State)

The Docker module should be a **pure infrastructure module** with zero business logic:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DockerModule (@Global)                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      DOCKER SERVICE                          │   │
│  │                                                              │   │
│  │  Container Operations:                                       │   │
│  │  ┌────────────────┬────────────────┬────────────────┐       │   │
│  │  │ createContainer│ startContainer │ stopContainer  │       │   │
│  │  │ removeContainer│ getContainerInfo│ listContainers │       │   │
│  │  │ execInContainer│ getContainerLogs│ restartContainer│      │   │
│  │  └────────────────┴────────────────┴────────────────┘       │   │
│  │                                                              │   │
│  │  Image Operations:                                          │   │
│  │  ┌────────────────┬────────────────┬────────────────┐       │   │
│  │  │  buildImage    │  pullImage     │  removeImage   │       │   │
│  │  └────────────────┴────────────────┴────────────────┘       │   │
│  │                                                              │   │
│  │  Health Operations:                                          │   │
│  │  ┌────────────────┬────────────────┬────────────────┐       │   │
│  │  │checkContainerHealth│getDetailedHealth│performHealthCheck│   │
│  │  │waitForHealth    │monitorDeployment│                │       │   │
│  │  └────────────────┴────────────────┴────────────────┘       │   │
│  │                                                              │   │
│  │  Volume Operations:                                          │   │
│  │  ┌────────────────┬────────────────┬────────────────┐       │   │
│  │  │putStringIntoVolume│copyFromContainerToVolume│runCommandInVolume│ │
│  │  └────────────────┴────────────────┴────────────────┘       │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      DOCKERODE CLIENT                        │   │
│  │  Connection options:                                         │   │
│  │  - DOCKER_HOST environment variable                          │   │
│  │  - /var/run/docker.sock (mounted socket)                     │   │
│  │  - Default Docker connection                                 │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

### 1. DockerService (Target State)

**Role**: Pure Docker infrastructure operations. No business logic.

```typescript
@Injectable()
export class DockerService {
  // ─────────────────────────────────────────────────────────────────
  // Container Lifecycle
  // ─────────────────────────────────────────────────────────────────
  createContainer(options: CreateContainerOptions): Promise<Docker.Container>
  createAndStartContainer(options: ContainerOptions): Promise<string>
  startContainersByDeployment(deploymentId: string): Promise<void>
  stopContainersByDeployment(deploymentId: string): Promise<void>
  stopContainer(containerIdOrName: string): Promise<void>
  restartContainer(containerId: string): Promise<void>
  removeContainer(containerId: string): Promise<void>
  
  // ─────────────────────────────────────────────────────────────────
  // Container Information
  // ─────────────────────────────────────────────────────────────────
  getContainerInfo(containerIdOrName: string): Promise<Docker.ContainerInspectInfo>
  listContainers(options?: Docker.ContainerListOptions): Promise<Docker.ContainerInfo[]>
  listContainersByDeployment(deploymentId: string): Promise<ContainerInfo[]>
  getContainerLogs(containerIdOrName: string, options?: LogOptions): Promise<string>
  getContainerStats(containerId: string): Promise<Record<string, any>>
  
  // ─────────────────────────────────────────────────────────────────
  // Container Execution
  // ─────────────────────────────────────────────────────────────────
  execInContainer(containerIdOrName: string, cmd: string[], input?: string): Promise<ExecResult>
  runCommandInHelperContainer(containerIdOrName: string, command: string): Promise<ExecResult>
  
  // ─────────────────────────────────────────────────────────────────
  // Image Operations
  // ─────────────────────────────────────────────────────────────────
  buildImage(sourcePath: string, imageTag: string): Promise<void>
  pullImage(image: string, registryAuth?: Docker.AuthConfig): Promise<void>
  removeImage(imageTag: string): Promise<void>
  
  // ─────────────────────────────────────────────────────────────────
  // Health Monitoring
  // ─────────────────────────────────────────────────────────────────
  checkContainerHealth(containerId: string): Promise<boolean>
  getDetailedContainerHealth(containerId: string): Promise<DetailedHealth>
  performHealthCheck(containerId: string, healthCheckUrl?: string): Promise<HealthResult>
  waitForContainerHealth(containerId: string, maxRetries?: number): Promise<boolean>
  monitorContainersByDeployment(deploymentId: string): Promise<ContainerHealthInfo[]>
  
  // ─────────────────────────────────────────────────────────────────
  // Volume Operations
  // ─────────────────────────────────────────────────────────────────
  putStringIntoVolume(volumeName: string, destPath: string, filename: string, content: string): Promise<void>
  copyFromContainerToVolume(sourceContainer: string, sourcePath: string, volumeName: string, destPath: string): Promise<void>
  runCommandInVolume(volumeName: string, command: string): Promise<ExecResult>
  findContainerWithPath(searchPath: string): Promise<string | null>
  
  // ─────────────────────────────────────────────────────────────────
  // Raw Client Access
  // ─────────────────────────────────────────────────────────────────
  getDockerClient(): Docker
  testConnection(): Promise<boolean>
  getSelfContainerId(): string | null
}
```

### 2. ZombieCleanupService (To Be Moved)

**Current Location**: `docker/services/zombie-cleanup.service.ts`  
**Target Location**: `cleanup/services/zombie-cleanup.service.ts` (new module)

**Reason for Move**: This service needs DeploymentService, ProjectService, and ServiceService to determine what containers are "orphaned". This business logic doesn't belong in the Docker infrastructure module.

---

## Dependency Flow (Target State)

```
Layer 0: Infrastructure Foundation
├── DockerModule (@Global)
│   └── DockerService (pure Docker operations)
│
├── DatabaseModule (@Global)
│   └── DatabaseService (Drizzle connection)
│
└── ConstantsModule
    └── ConstantsService (configuration)

Layer 1: Core Business Services
├── DeploymentModule
│   └── imports: (uses @Global DockerModule automatically)
│
├── ProjectsModule
│   └── imports: TraefikCoreModule
│   └── (uses @Global DockerModule automatically)
│
├── ServiceModule
│   └── (uses @Global DockerModule automatically)
│
└── StorageModule
    └── (uses @Global DockerModule automatically)

Layer 2: Orchestration & Cleanup
├── OrchestrationModule
│   └── imports: DeploymentModule, ServiceModule, etc.
│
└── CleanupModule (NEW)
    └── imports: DeploymentModule, ProjectModule, ServiceModule
    └── providers: ZombieCleanupService
```

---

## Migration Plan

### Phase 1: Create CleanupModule

```typescript
// apps/api/src/core/modules/cleanup/cleanup.module.ts
@Module({
  imports: [
    ScheduleModule.forRoot(),
    CoreDeploymentModule,
    ProjectModule,
    ServiceModule,
  ],
  providers: [
    ZombieCleanupService, // Moved from Docker module
  ],
  exports: [
    ZombieCleanupService,
  ],
})
export class CleanupModule {}
```

### Phase 2: Simplify DockerModule

```typescript
// apps/api/src/core/modules/docker/docker.module.ts
@Global()
@Module({
  imports: [], // NO business module imports
  providers: [
    DockerService,
  ],
  exports: [
    DockerService,
  ],
})
export class DockerModule {}
```

### Phase 3: Update CoreModule

```typescript
// Ensure CleanupModule is imported in CoreModule or AppModule
@Module({
  imports: [
    DockerModule,       // Now clean
    CleanupModule,      // New module with ZombieCleanupService
    // ... other modules
  ],
})
export class CoreModule {}
```

---

## Data Flow

### Container Creation Flow

```
1. Any service calls DockerService.createAndStartContainer()
   │
2. DockerService checks image existence
   │
3. If image missing and policy allows → pullImage()
   │
4. DockerService.createContainer() via dockerode
   │
5. container.start()
   │
6. Return container ID
```

### Health Check Flow

```
1. Any service calls DockerService.getDetailedContainerHealth(containerId)
   │
2. DockerService.getContainer(containerId).inspect()
   │
3. Extract state, health status, restart count
   │
4. Optional: container.stats() for resource usage
   │
5. Return DetailedHealth object
```

### Volume Write Flow

```
1. Service calls DockerService.putStringIntoVolume(volumeName, path, filename, content)
   │
2. Create temporary helper container with volume mounted
   │
3. Base64 encode content for safe transfer
   │
4. exec: decode and write file
   │
5. Remove helper container
   │
6. Return success/failure
```

---

## Interface Definitions

### CreateContainerOptions

```typescript
export interface CreateContainerOptions extends Docker.ContainerCreateOptions {
  image?: string;                           // Backward compat
  imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never';
  registryAuth?: Docker.AuthConfig;
}
```

### ContainerOptions (for createAndStartContainer)

```typescript
interface ContainerOptions {
  image: string;
  name: string;
  deploymentId: string;
  envVars?: Record<string, string>;
  ports?: Record<string, string>;           // containerPort → hostPort
  imagePullPolicy?: 'IfNotPresent' | 'Always' | 'Never';
  registryAuth?: Docker.AuthConfig;
}
```

### DetailedHealth

```typescript
interface DetailedHealth {
  isHealthy: boolean;
  status: string;
  uptime: number;                           // seconds
  restartCount: number;
  lastStarted: Date | null;
  healthChecks?: {
    status: string;
    failingStreak: number;
    log: Array<{
      start: string;
      end: string;
      exitCode: number;
      output: string;
    }>;
  };
  resources: {
    cpuUsage?: number;                      // percentage
    memoryUsage?: number;                   // bytes
    memoryLimit?: number;                   // bytes
  };
}
```

### ExecResult

```typescript
interface ExecResult {
  exitCode: number;
  output: string;
}
```

---

## Security Considerations

1. **Docker Socket Access**
   - Service requires access to Docker socket
   - Container must have `/var/run/docker.sock` mounted
   - Security implications of Docker-in-Docker pattern

2. **Container Labels**
   - Always set `deployer.deployment_id` for tracking
   - Always set `deployer.managed=true` for cleanup identification
   - Never trust user-provided labels without validation

3. **Image Pull Security**
   - Use `registryAuth` for private registries
   - Validate image references before pulling
   - Consider image scanning integration

4. **Volume Security**
   - Be careful with volume mounts to host paths
   - Use named volumes where possible
   - Validate paths before writing

---

## Performance Considerations

1. **Connection Reuse**
   - DockerService maintains a single dockerode instance
   - All operations share this connection

2. **Stream Handling**
   - Build and log operations use streaming
   - followStream helper properly drains streams

3. **Retry Logic**
   - pullImage has built-in retry with exponential backoff
   - Container creation retries on image-not-found

4. **Helper Container Cleanup**
   - Volume operations always clean up helper containers
   - Even on error, cleanup is attempted

---

## Testing Strategy

With the clean architecture:

```typescript
// DockerService can be tested in isolation
describe('DockerService', () => {
  let service: DockerService;
  let mockDocker: jest.Mocked<Docker>;

  beforeEach(() => {
    mockDocker = createMockDocker();
    service = new DockerService();
    service['docker'] = mockDocker;
  });

  it('should create container', async () => {
    mockDocker.createContainer.mockResolvedValue(mockContainer);
    const result = await service.createContainer({ Image: 'nginx' });
    expect(result).toBeDefined();
  });
});
```

No business modules needed for testing Docker!
