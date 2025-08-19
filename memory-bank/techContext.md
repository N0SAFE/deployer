# Tech Context: Universal Deployment Platform

## Current Technology Stack

### Frontend (Next.js 15.4)
- **Framework**: Next.js with App Router, React 19, Server Components
- **UI Library**: Shadcn UI with Radix UI primitives, Tailwind CSS 4.x
- **State Management**: Zustand for client state, React Query for server state
- **Authentication**: Better Auth integration with session management
- **Routing**: Declarative routing system for type-safe navigation
- **Real-time**: Will integrate WebSocket for deployment status updates

### Backend (NestJS 10.x)
- **Framework**: NestJS with TypeScript, dependency injection
- **API Layer**: ORPC for type-safe end-to-end contracts
- **Authentication**: Better Auth with NestJS integration (@mguay/nestjs-better-auth)
- **Database**: PostgreSQL with Drizzle ORM, type-safe queries
- **Caching**: Redis for job queues, session storage, and caching
- **Validation**: Zod schemas for request/response validation

### Infrastructure & DevOps
- **Containerization**: Docker with Docker Compose orchestration
- **Build System**: Turborepo for monorepo management
- **Package Manager**: Bun 1.2.14 for faster dependency resolution
- **Testing**: Vitest with React Testing Library, merged coverage reporting
- **Linting**: ESLint 9 with Prettier for code formatting

### Database Schema (Drizzle ORM)
Current tables to extend:
```typescript
// Existing user management (Better Auth)
users, sessions, accounts

// New deployment tables needed:
projects, services, deployments, preview_environments,
service_dependencies, deployment_logs, project_collaborators
```

## Deployment Architecture Requirements

### Container Orchestration Strategy
**Decision Required**: Choose primary orchestration method
- **Option 1**: Docker Compose (simple, fits existing patterns)
- **Option 2**: Docker Swarm (moderate complexity, better scaling)  
- **Option 3**: Lightweight K8s (k3s/microk8s - complex but powerful)

**Current Recommendation**: Start with Docker Compose, architect for easy migration to Docker Swarm

### Git Integration Approach
**Libraries to Integrate**:
```json
{
  "simple-git": "^3.21.0",          // Git operations
  "@octokit/rest": "^20.0.2",       // GitHub API
  "@gitbeaker/node": "^35.8.1",     // GitLab API
  "tar-stream": "^3.1.6",           // Archive handling
  "multer": "^1.4.5-lts.1"          // File uploads
}
```

### Real-time Communication
**ORPC WebSocket Implementation**:
```typescript
// ORPC WebSocket contracts for deployment updates
import { o } from '@orpc/contract';
import { z } from 'zod';

export const deploymentWebSocketContract = o.contract({
  // Subscribe to deployment updates for a project
  subscribeToProject: o.route({
    method: 'GET',
    path: '/ws/projects/:projectId/deployments',
    responses: {
      200: z.object({
        type: z.enum(['deployment.started', 'deployment.progress', 'deployment.completed', 'deployment.failed']),
        deploymentId: z.string(),
        serviceId: z.string(),
        data: z.object({
          progress: z.number().optional(),
          message: z.string().optional(),
          logs: z.array(z.string()).optional(),
          error: z.string().optional(),
        })
      })
    }
  }),
  
  // Subscribe to specific deployment logs
  subscribeToDeploymentLogs: o.route({
    method: 'GET', 
    path: '/ws/deployments/:deploymentId/logs',
    responses: {
      200: z.object({
        level: z.enum(['info', 'warn', 'error', 'debug']),
        message: z.string(),
        timestamp: z.string(),
        phase: z.string().optional(),
        step: z.string().optional(),
      })
    }
  })
});

// ORPC WebSocket service implementation
@Injectable()
export class DeploymentWebSocketService {
  // Emit deployment update via ORPC WebSocket
  emitDeploymentUpdate(projectId: string, update: DeploymentUpdate) {
    // Use ORPC's WebSocket implementation
    this.orpcWebSocket.emit(`projects/${projectId}/deployments`, update);
  }
  
  emitDeploymentLogs(deploymentId: string, logEntry: LogEntry) {
    this.orpcWebSocket.emit(`deployments/${deploymentId}/logs`, logEntry);
  }
}
```

### Job Queue System
**Bull Queue with Redis**:
```json
{
  "bull": "^4.12.2",
  "@nestjs/bull": "^10.0.1"
}
```

```typescript
// Queue configuration
@Module({
  imports: [
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT),
      },
    }),
    BullModule.registerQueue({
      name: 'deployment',
    }),
  ],
})
export class DeploymentModule {}
```

## Development Environment Extensions

### New Environment Variables
```env
# Deployment Configuration
DEPLOYER_BASE_DOMAIN=localhost
DEPLOYER_STORAGE_PATH=/var/lib/deployer
DEPLOYER_MAX_CONCURRENT_DEPLOYMENTS=3

# Git Integration
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITLAB_ACCESS_TOKEN=

# Container Registry (optional)
DOCKER_REGISTRY_URL=
DOCKER_REGISTRY_USERNAME=
DOCKER_REGISTRY_PASSWORD=

# Webhook Security
WEBHOOK_SECRET=
```

### Docker Compose Extensions
**New Services to Add**:
```yaml
services:
  # Existing: api, web, db, redis
  
  registry:
    image: registry:2
    ports:
      - "5000:5000"
    environment:
      REGISTRY_STORAGE_FILESYSTEM_ROOTDIRECTORY: /var/lib/registry
    volumes:
      - registry_data:/var/lib/registry
      
  traefik:
    image: traefik:v2.10
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
    ports:
      - "80:80"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
```

## API Contract Extensions

### New ORPC Routes
```typescript
// packages/api-contracts/deployment.ts
export const deploymentContract = o.contract({
  // Project Management
  'projects.create': o.route({
    method: 'POST',
    path: '/projects',
    body: projectCreateSchema,
    responses: { 200: projectSchema }
  }),
  
  // Deployment Operations
  'deployments.trigger': o.route({
    method: 'POST', 
    path: '/projects/:projectId/services/:serviceId/deploy',
    body: deployTriggerSchema,
    responses: { 200: deploymentSchema }
  }),
  
  // Real-time Updates
  'deployments.subscribe': o.route({
    method: 'GET',
    path: '/deployments/:deploymentId/events',
    // WebSocket upgrade
  }),
  
  // Preview Environments
  'previews.create': o.route({
    method: 'POST',
    path: '/projects/:projectId/previews',
    body: previewCreateSchema,
    responses: { 200: previewSchema }
  })
});
```

## File Storage Strategy

### Local Storage Implementation
**Directory Structure**:
```
/var/lib/deployer/
├── projects/
│   ├── {projectId}/
│   │   ├── sources/          # Git clones, uploaded files
│   │   ├── builds/           # Build artifacts
│   │   └── deployments/      # Deployment history
├── registry/                 # Local Docker registry
└── logs/                     # Deployment logs
```

### Storage Provider Interface
```typescript
interface StorageProvider {
  // Source management
  cloneRepository(url: string, branch: string, destination: string): Promise<void>;
  extractUpload(file: Buffer, destination: string): Promise<void>;
  
  // Build artifacts
  storeBuildArtifacts(projectId: string, buildId: string, artifacts: Buffer): Promise<void>;
  retrieveBuildArtifacts(projectId: string, buildId: string): Promise<Buffer>;
  
  // Cleanup
  cleanupOldDeployments(projectId: string, keepCount: number): Promise<void>;
}
```

## Security Considerations

### Webhook Validation
```typescript
import * as crypto from 'crypto';

function validateWebhook(payload: string, signature: string, secret: string): boolean {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = 'sha256=' + hmac.digest('hex');
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
}
```

### Container Isolation
```typescript
// Docker security options for deployed containers
const securityOptions = {
  SecurityOpt: [
    'no-new-privileges:true',
    'apparmor:docker-default'
  ],
  ReadonlyRootfs: true,
  User: '1000:1000', // Non-root user
  CapDrop: ['ALL'],
  CapAdd: ['NET_BIND_SERVICE'] // Only if needed for port binding
};
```

## Performance Considerations

### Concurrent Deployment Limits
```typescript
// Limit concurrent deployments to prevent resource exhaustion
const deploymentQueue = new Bull('deployment', {
  settings: {
    stalledInterval: 30 * 1000,
    maxStalledCount: 1
  },
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 5,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  }
});

// Process with concurrency limit
deploymentQueue.process('deploy', 3, processDeployment);
```

### Database Indexing Strategy
```sql
-- Performance indexes for common queries
CREATE INDEX idx_deployments_service_created ON deployments(service_id, created_at DESC);
CREATE INDEX idx_deployment_logs_deployment_timestamp ON deployment_logs(deployment_id, timestamp DESC);
CREATE INDEX idx_services_project ON services(project_id);
CREATE INDEX idx_previews_expires ON previews(expires_at) WHERE expires_at IS NOT NULL;
```

## Development Tooling

### New Development Scripts
```json
{
  "scripts": {
    "dev:full": "docker-compose -f docker-compose.yml -f docker-compose.deployment.yml up",
    "deployment:test": "bun test -- deployment",
    "db:seed:deployment": "bun run api -- db:seed:deployment",
    "registry:clean": "docker exec deployer-registry registry garbage-collect /etc/docker/registry/config.yml"
  }
}
```

### Testing Strategy Extensions
```typescript
// Integration tests for deployment pipeline
describe('Deployment Pipeline', () => {
  it('should deploy from GitHub repository', async () => {
    const mockRepo = await createMockRepository();
    const deployment = await triggerDeployment(mockRepo);
    expect(deployment.status).toBe('success');
  });
  
  it('should handle deployment failures gracefully', async () => {
    // Test error handling and rollback
  });
  
  it('should create preview environments with correct subdomain', async () => {
    // Test preview environment creation
  });
});
```

## Migration Strategy

### Phase 1: Core Infrastructure
- Extend database schema with deployment tables
- Add job queue and WebSocket capabilities  
- Create basic deployment engine with Docker Compose

### Phase 2: Git Integration
- Add GitHub/GitLab webhook handlers
- Implement git clone and build processes
- Create deployment trigger mechanisms

### Phase 3: Preview System
- Implement subdomain generation
- Add Traefik for reverse proxy
- Create preview environment lifecycle management

### Phase 4: Advanced Features
- Multi-service dependency management
- Role-based access control
- Resource monitoring and alerts