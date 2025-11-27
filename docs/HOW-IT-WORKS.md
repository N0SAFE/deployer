# How It Works: Universal Deployment Platform

This document explains the technical architecture, data flows, and system interactions that make the deployment platform work.

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Core Components](#core-components)
3. [Deployment Workflows](#deployment-workflows)
4. [Multi-Service Orchestration](#multi-service-orchestration)
5. [Preview Environment System](#preview-environment-system)
6. [Real-Time Communication](#real-time-communication)
7. [Security Architecture](#security-architecture)
8. [Resource Management](#resource-management)

---

## System Architecture

### High-Level Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Interface Layer                      │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   Dashboard  │  │   Project    │  │  Deployment  │         │
│  │   (Next.js)  │  │  Management  │  │    Logs      │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└───────────────────────────┬──────────────────────────────────────┘
                            │ ORPC Type-Safe API
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer (NestJS)                       │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │    ORPC      │  │ Better Auth  │  │   WebSocket  │         │
│  │  Controllers │  │     Auth     │  │    Gateway   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Deployment  │  │     Git      │  │   Traefik    │         │
│  │   Service    │  │   Service    │  │   Service    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Infrastructure Layer                          │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  PostgreSQL  │  │    Redis     │  │  File        │         │
│  │  Database    │  │  Job Queue   │  │  Storage     │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐                            │
│  │ Docker Swarm │  │   Traefik    │                            │
│  │ Orchestrator │  │  Reverse     │                            │
│  │              │  │   Proxy      │                            │
│  └──────────────┘  └──────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow Architecture

```
User Action (Deploy) → API Controller → Service Layer → Repository → Database
                                    ↓
                            Deployment Job Queue
                                    ↓
                        Background Job Processor
                                    ↓
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
            Docker Swarm                      Traefik Config
            Stack Deploy                      Domain Mapping
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
                          WebSocket Notification
                                    ▼
                              User Dashboard
```

---

## Core Components

### 1. Frontend Dashboard (Next.js)

**Purpose:** User interface for managing projects, deployments, and services

**Key Features:**
- Real-time deployment status via WebSocket
- Visual dependency graph rendering
- Resource usage monitoring
- Log streaming interface
- Project and service management

**Technology Stack:**
- Next.js 15 (App Router, Server Components)
- React 19 (UI rendering)
- Shadcn UI (Component library)
- Tailwind CSS (Styling)
- Zustand (Client state management)
- React Query (Server state caching)

**Communication:**
- ORPC type-safe API calls to NestJS backend
- WebSocket connection for real-time updates
- Server-side rendering for initial page loads

---

### 2. API Backend (NestJS)

**Purpose:** Business logic, data management, and deployment orchestration

**Architecture Pattern:** Service-Adapter-Controller

```typescript
// Request Flow
Controller (HTTP/WebSocket)
    ↓ (ORPC contract validation)
Service (Business Logic)
    ↓ (Data operations)
Repository (Database Access)
    ↓ (ORM queries)
Database (PostgreSQL)

// Response Flow
Database → Repository → Service → Adapter (Data Transformation) → Controller → Client
```

**Key Services:**

1. **DeploymentService**: Orchestrates deployment lifecycle
2. **GitService**: Handles Git operations (clone, fetch, checkout)
3. **DockerService**: Manages Docker container operations
4. **TraefikService**: Configures reverse proxy and SSL
5. **ResourceAllocationService**: Manages resource quotas
6. **SwarmOrchestrationService**: Docker Swarm management

**Technology Stack:**
- NestJS 10 (Framework)
- ORPC (Type-safe API contracts)
- Better Auth (Authentication)
- Drizzle ORM (Database access)
- Bull (Job queue with Redis)
- WebSocket (Real-time communication)

---

### 3. Database Layer (PostgreSQL + Drizzle ORM)

**Purpose:** Persistent storage for all application data

**Core Tables:**

```sql
-- User Management (Better Auth)
users, sessions, accounts

-- Project Management
projects (id, name, owner_id, base_domain, created_at)
services (id, project_id, name, type, port, env_vars)
service_dependencies (service_id, depends_on_service_id)

-- Deployment Tracking
deployments (id, service_id, source_type, source_config, commit_sha, status)
deployment_logs (id, deployment_id, timestamp, level, message)

-- Preview Environments
previews (id, deployment_id, subdomain, expires_at, webhook_trigger)

-- Orchestration (Docker Swarm)
orchestration_stacks (id, project_id, name, status, compose_config)
service_instances (id, stack_id, service_name, replicas, status)
network_assignments (id, stack_id, network_name, subnet)
resource_allocations (id, stack_id, cpu_quota, memory_limit)
ssl_certificates (id, domain, certificate_data, expires_at)

-- Access Control
project_collaborators (project_id, user_id, role)
api_keys (id, user_id, project_id, scopes, expires_at)

-- System Monitoring
system_metrics (id, timestamp, cpu_usage, memory_usage, storage_usage)
deployment_jobs (id, job_id, type, status, started_at, completed_at)
```

**Relationships:**

```
User → Projects → Services → Deployments → Logs
                     ↓           ↓
                Dependencies  Previews
```

---

### 4. Job Queue System (Redis + Bull)

**Purpose:** Asynchronous processing of long-running deployment tasks

**Job Types:**

1. **Build Job**: Builds application from source code
2. **Deploy Job**: Deploys containers to Docker Swarm
3. **Update Job**: Updates running service configuration
4. **Remove Job**: Removes deployed service and resources
5. **Scale Job**: Scales service replicas up or down
6. **Certificate Renewal Job**: Renews SSL certificates

**Queue Configuration:**

```typescript
// Job processing with retry logic
{
  attempts: 3,                    // Retry failed jobs 3 times
  backoff: {
    type: 'exponential',
    delay: 2000                   // Exponential backoff starting at 2s
  },
  removeOnComplete: 10,           // Keep last 10 completed jobs
  removeOnFail: 5,                // Keep last 5 failed jobs
  timeout: 600000                 // 10-minute timeout per job
}
```

**Processing Flow:**

```
User triggers deployment
    ↓
Controller creates deployment record
    ↓
Job added to Bull queue
    ↓
Processor picks up job
    ↓
Execute build/deploy steps
    ↓
Update deployment status in database
    ↓
Emit WebSocket event
    ↓
User dashboard updates in real-time
```

---

### 5. Docker Swarm Orchestration

**Purpose:** Container management and service orchestration

**Docker Swarm Mode Benefits:**
- Built-in service discovery
- Automatic load balancing
- Rolling updates with zero downtime
- Health check integration
- Secret management
- Multi-host networking

**Stack Deployment:**

```yaml
# Generated Docker Compose file for each deployment
version: '3.8'
services:
  web:
    image: registry.local/project-123/web:abc123
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
      labels:
        - traefik.enable=true
        - traefik.http.routers.web.rule=Host(`app.domain.com`)
        - traefik.http.routers.web.tls=true
    networks:
      - project-network
    environment:
      - NODE_ENV=production

networks:
  project-network:
    driver: overlay
```

**Resource Isolation:**
- Each project gets isolated overlay network
- CPU and memory quotas enforced
- Volume isolation per project
- Network traffic separation

---

### 6. Traefik Reverse Proxy

**Purpose:** Automatic reverse proxy, load balancing, and SSL management

**Key Responsibilities:**
1. **Domain Routing**: Route subdomains to correct services
2. **SSL Termination**: Automatic Let's Encrypt certificates
3. **Load Balancing**: Distribute traffic across replicas
4. **Service Discovery**: Auto-detect Docker Swarm services
5. **Middleware**: Rate limiting, CORS, authentication

**Automatic Configuration:**

```typescript
// Traefik labels auto-generated for each service
function generateTraefikLabels(deployment: Deployment): Record<string, string> {
  const subdomain = generateSubdomain(deployment);
  const serviceName = `${deployment.projectId}-${deployment.serviceId}`;
  
  return {
    'traefik.enable': 'true',
    
    // HTTP Router
    [`traefik.http.routers.${serviceName}.rule`]: 
      `Host(\`${subdomain}.${deployment.baseDomain}\`)`,
    
    // HTTPS with automatic SSL
    [`traefik.http.routers.${serviceName}.tls`]: 'true',
    [`traefik.http.routers.${serviceName}.tls.certresolver`]: 'letsencrypt',
    
    // Service configuration
    [`traefik.http.services.${serviceName}.loadbalancer.server.port`]: 
      deployment.port.toString(),
    
    // Middleware (optional)
    [`traefik.http.routers.${serviceName}.middlewares`]: 
      'rate-limit@file,cors@file'
  };
}
```

**SSL Certificate Flow:**

```
New deployment with custom domain
    ↓
Traefik detects new service via Docker labels
    ↓
Initiates Let's Encrypt ACME challenge
    ↓
Certificate provisioned (< 30 seconds)
    ↓
HTTPS enabled automatically
    ↓
Certificate stored in database
    ↓
Auto-renewal scheduled (90 days)
```

---

## Deployment Workflows

### Basic Deployment Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ Step 1: User Initiates Deployment                               │
│                                                                  │
│ User clicks "Deploy" button in dashboard                        │
│     ↓                                                            │
│ Frontend calls ORPC deployment.trigger endpoint                 │
│     ↓                                                            │
│ API validates request and user permissions                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 2: Deployment Record Created                               │
│                                                                  │
│ DeploymentService creates deployment record in database         │
│     ↓                                                            │
│ Status: 'queued', Initial metadata stored                       │
│     ↓                                                            │
│ Job ID generated and returned to user                           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 3: Job Queue Processing                                    │
│                                                                  │
│ Bull queue adds job with deployment configuration               │
│     ↓                                                            │
│ DeploymentProcessor picks up job from queue                     │
│     ↓                                                            │
│ Status updated: 'queued' → 'building'                           │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 4: Source Code Acquisition                                 │
│                                                                  │
│ Based on source type:                                           │
│   - GitHub: Clone via GitHub API + webhook data                 │
│   - GitLab: Clone via GitLab API                                │
│   - Git: Clone via simple-git with credentials                  │
│   - Upload: Extract uploaded ZIP file                           │
│     ↓                                                            │
│ Source code stored in /var/lib/deployer/projects/{id}/source    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 5: Build Process                                           │
│                                                                  │
│ Read build configuration (Dockerfile or buildpack detection)    │
│     ↓                                                            │
│ Docker build executed:                                          │
│   docker build -t registry.local/project-123/web:commit-sha .   │
│     ↓                                                            │
│ Build logs streamed to database and WebSocket                   │
│     ↓                                                            │
│ Image pushed to local Docker registry                           │
│     ↓                                                            │
│ Status updated: 'building' → 'deploying'                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 6: Docker Swarm Deployment                                 │
│                                                                  │
│ SwarmOrchestrationService generates docker-compose.yml          │
│     ↓                                                            │
│ Stack deployed to Docker Swarm:                                 │
│   docker stack deploy -c compose.yml project-123-web            │
│     ↓                                                            │
│ Traefik labels applied for domain routing                       │
│     ↓                                                            │
│ Service health check initiated                                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 7: SSL Certificate Provisioning                            │
│                                                                  │
│ TraefikService detects new service via Docker events            │
│     ↓                                                            │
│ Initiates Let's Encrypt ACME challenge                          │
│     ↓                                                            │
│ Certificate provisioned and stored                              │
│     ↓                                                            │
│ HTTPS enabled for subdomain                                     │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Step 8: Health Verification & Completion                        │
│                                                                  │
│ Poll service health endpoint (up to 2 minutes)                  │
│     ↓                                                            │
│ If healthy:                                                     │
│   - Status updated: 'deploying' → 'success'                     │
│   - Deployment URL recorded                                     │
│   - WebSocket event: 'deployment.completed'                     │
│     ↓                                                            │
│ If unhealthy:                                                   │
│   - Status updated: 'deploying' → 'failed'                      │
│   - Rollback initiated (if enabled)                             │
│   - WebSocket event: 'deployment.failed'                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
                   User sees live deployment!
```

---

## Multi-Service Orchestration

### Service Dependency Management

**Dependency Graph Example:**

```
Frontend (React App)
    ↓ depends on
API (NestJS)
    ↓ depends on
Database (PostgreSQL)
    ↓ depends on
Cache (Redis)
```

**Deployment Order Resolution:**

```typescript
// Topological sort algorithm determines deployment order
interface ServiceDependency {
  serviceId: string;
  dependsOn: string[];
}

function calculateDeploymentOrder(services: ServiceDependency[]): string[] {
  // Build dependency graph
  const graph = buildGraph(services);
  
  // Perform topological sort
  const order = topologicalSort(graph);
  
  // Returns: ['redis', 'postgres', 'api', 'frontend']
  return order;
}
```

**Cascade Deployment Flow:**

```
User deploys API service
    ↓
System detects Frontend depends on API
    ↓
Trigger cascade deployment job
    ↓
Rebuild Frontend with new API endpoint
    ↓
Deploy Frontend to Docker Swarm
    ↓
Health check both services
    ↓
Update status: Both services healthy
    ↓
Notify user via WebSocket
```

**Failure Handling:**

```
API deployment fails
    ↓
Check if Frontend depends on API
    ↓
Mark Frontend deployment as 'blocked'
    ↓
Prevent cascade deployment
    ↓
Notify user: "API deployment failed, Frontend not deployed"
    ↓
User fixes API issues
    ↓
Retry API deployment
    ↓
If successful, resume Frontend deployment
```

---

## Preview Environment System

### Automatic Preview Creation

**GitHub PR Preview Flow:**

```
Developer opens Pull Request on GitHub
    ↓
GitHub sends webhook to platform
    ↓
Webhook validated (HMAC signature)
    ↓
Extract PR metadata (number, branch, commit)
    ↓
Create preview deployment record
    ↓
Generate subdomain: feature-auth-pr-123.domain.com
    ↓
Queue build job with preview configuration
    ↓
Build and deploy to isolated environment
    ↓
Provision SSL certificate
    ↓
Post preview URL as PR comment
    ↓
Developer and reviewers access preview
    ↓
PR merged or closed
    ↓
Preview environment automatically destroyed
```

### Subdomain Generation Strategy

```typescript
interface PreviewConfig {
  projectName: string;
  branch?: string;
  prNumber?: number;
  customName?: string;
}

function generateSubdomain(config: PreviewConfig): string {
  // Sanitize branch name (remove special characters)
  const sanitizedBranch = config.branch
    ?.toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .substring(0, 20);
  
  // Priority: Custom name > PR number > Branch name
  const identifier = config.customName 
    ? sanitize(config.customName)
    : config.prNumber 
      ? `pr-${config.prNumber}`
      : sanitizedBranch;
  
  // Format: {project}-{identifier}.{baseDomain}
  return `${config.projectName}-${identifier}`;
}

// Examples:
// - my-app-pr-42.domain.com
// - my-app-feature-auth.domain.com
// - my-app-staging.domain.com
```

### Environment Variable Inheritance

**Hierarchical Configuration:**

```typescript
// Global variables (all projects)
GLOBAL_VAR=value

// Project-level variables (all services in project)
PROJECT_VAR=value

// Service-level variables (specific service)
SERVICE_VAR=value

// Preview-level variables (override for preview)
PREVIEW_VAR=value

// Final environment (merge order: global < project < service < preview)
{
  GLOBAL_VAR: 'value',      // From global
  PROJECT_VAR: 'value',     // From project
  SERVICE_VAR: 'value',     // From service
  PREVIEW_VAR: 'value'      // From preview (highest priority)
}
```

### Lifecycle Management

```
Preview Created
    ↓
Active (accessible via subdomain)
    ↓
Expiration timer starts (default: 7 days)
    ↓
Branch merged or PR closed
    ↓
Grace period (24 hours for recovery)
    ↓
Cleanup job triggered
    ↓
Docker stack removed
    ↓
SSL certificate revoked
    ↓
Database record marked as 'deleted'
    ↓
Storage artifacts cleaned up
```

---

## Real-Time Communication

### WebSocket Architecture

**Connection Setup:**

```typescript
// Frontend establishes WebSocket connection
const socket = io('wss://api.domain.com', {
  auth: {
    token: sessionToken  // Better Auth session
  },
  transports: ['websocket']
});

// Subscribe to project events
socket.emit('subscribe', { projectId: 'project-123' });

// Listen for deployment events
socket.on('deployment.started', (data) => {
  updateUI({ status: 'building', progress: 0 });
});

socket.on('deployment.progress', (data) => {
  updateUI({ progress: data.progress, message: data.message });
});

socket.on('deployment.completed', (data) => {
  updateUI({ status: 'success', url: data.url });
});

socket.on('deployment.failed', (data) => {
  updateUI({ status: 'failed', error: data.error });
});
```

**Event Types:**

```typescript
interface DeploymentEvent {
  type: 'deployment.started' | 'deployment.progress' | 
        'deployment.completed' | 'deployment.failed';
  projectId: string;
  serviceId: string;
  deploymentId: string;
  data: {
    progress?: number;        // 0-100
    message?: string;         // Human-readable status
    logs?: LogEntry[];        // Build/deploy logs
    url?: string;             // Deployment URL (on success)
    error?: string;           // Error message (on failure)
  };
}
```

**Room-Based Broadcasting:**

```typescript
// Backend emits to specific rooms
io.to(`project:${projectId}`).emit('deployment.progress', event);
io.to(`deployment:${deploymentId}`).emit('log.entry', logEntry);
io.to(`user:${userId}`).emit('notification', notification);
```

---

## Security Architecture

### Authentication & Authorization

**Better Auth Integration:**

```
User logs in via Better Auth
    ↓
Session created in database
    ↓
JWT token issued
    ↓
Token stored in HTTP-only cookie
    ↓
Every API request includes token
    ↓
NestJS guard validates token
    ↓
User context attached to request
    ↓
Authorization check (role-based)
    ↓
Request processed or rejected
```

**Role-Based Permissions:**

```typescript
enum ProjectRole {
  OWNER = 'owner',           // Full access
  ADMIN = 'admin',           // Deploy, manage users
  DEVELOPER = 'developer',   // Deploy, view logs
  VIEWER = 'viewer'          // Read-only access
}

const permissions = {
  [ProjectRole.OWNER]: ['*'],  // All permissions
  [ProjectRole.ADMIN]: [
    'deploy', 'manage_services', 'view_logs', 
    'manage_collaborators', 'manage_env_vars'
  ],
  [ProjectRole.DEVELOPER]: [
    'deploy', 'view_logs', 'create_previews'
  ],
  [ProjectRole.VIEWER]: [
    'view_projects', 'view_logs'
  ]
};
```

### Webhook Validation

**GitHub Webhook Security:**

```typescript
import * as crypto from 'crypto';

function validateGitHubWebhook(
  payload: string, 
  signature: string, 
  secret: string
): boolean {
  // GitHub sends signature as: sha256=<hash>
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  const digest = 'sha256=' + hmac.digest('hex');
  
  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(signature), 
    Buffer.from(digest)
  );
}

// Usage in controller
@Post('/webhooks/github')
async handleGitHubWebhook(@Req() req: Request) {
  const signature = req.headers['x-hub-signature-256'];
  const payload = JSON.stringify(req.body);
  
  if (!validateGitHubWebhook(payload, signature, process.env.GITHUB_WEBHOOK_SECRET)) {
    throw new UnauthorizedException('Invalid webhook signature');
  }
  
  // Process webhook...
}
```

### Container Isolation

**Docker Security Options:**

```yaml
services:
  user-app:
    # Run as non-root user
    user: "1000:1000"
    
    # Read-only root filesystem
    read_only: true
    
    # Security options
    security_opt:
      - no-new-privileges:true
      - apparmor:docker-default
    
    # Drop all capabilities, add only needed ones
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE  # Only if binding to port < 1024
    
    # Resource limits
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
```

---

## Resource Management

### Resource Allocation System

**Quota Enforcement:**

```typescript
interface ResourceQuota {
  cpuQuota: number;        // CPU cores (0.1 - 16)
  memoryLimit: number;     // Memory in MB (128 - 16384)
  storageLimit: number;    // Storage in GB (1 - 100)
  maxReplicas: number;     // Max container replicas (1 - 10)
}

async function validateResourceAllocation(
  projectId: string, 
  requested: ResourceQuota
): Promise<boolean> {
  // Get current usage
  const current = await getCurrentUsage(projectId);
  
  // Get project quota
  const quota = await getProjectQuota(projectId);
  
  // Check if request exceeds quota
  if (current.cpu + requested.cpuQuota > quota.cpuQuota) {
    throw new Error('CPU quota exceeded');
  }
  
  if (current.memory + requested.memoryLimit > quota.memoryLimit) {
    throw new Error('Memory quota exceeded');
  }
  
  // Check system capacity
  const systemCapacity = await getSystemCapacity();
  if (!hasCapacity(systemCapacity, requested)) {
    throw new Error('Insufficient system resources');
  }
  
  return true;
}
```

### Monitoring and Alerts

**System Metrics Collection:**

```typescript
// Cron job runs every minute
@Cron('* * * * *')
async collectSystemMetrics() {
  const metrics = {
    timestamp: new Date(),
    cpuUsage: await getCPUUsage(),
    memoryUsage: await getMemoryUsage(),
    storageUsage: await getStorageUsage(),
    activeDeployments: await countActiveDeployments(),
    queuedJobs: await countQueuedJobs()
  };
  
  // Store in database
  await this.db.insert(systemMetrics).values(metrics);
  
  // Check thresholds
  if (metrics.cpuUsage > 80) {
    await this.alertService.notify('High CPU usage detected');
  }
  
  if (metrics.memoryUsage > 90) {
    await this.alertService.notify('Critical memory usage');
  }
}
```

**Resource Cleanup:**

```typescript
// Daily cleanup job
@Cron('0 2 * * *')  // Run at 2 AM daily
async cleanupResources() {
  // Remove expired preview environments
  await this.removeExpiredPreviews();
  
  // Archive old deployment logs (> 30 days)
  await this.archiveOldLogs();
  
  // Cleanup unused Docker images
  await this.pruneDockerImages();
  
  // Remove orphaned SSL certificates
  await this.cleanupOrphanedCertificates();
}
```

---

## Summary

This deployment platform works through a carefully orchestrated system of modern technologies:

1. **User Interface**: Next.js dashboard with real-time WebSocket updates
2. **API Layer**: NestJS with ORPC for type-safe communication
3. **Job Processing**: Redis + Bull for asynchronous deployment tasks
4. **Orchestration**: Docker Swarm for container management
5. **Routing**: Traefik for automatic reverse proxy and SSL
6. **Data Storage**: PostgreSQL for metadata, file system for artifacts
7. **Real-Time**: WebSocket for live deployment status updates
8. **Security**: Better Auth + role-based permissions + webhook validation
9. **Resource Management**: Quotas, monitoring, and automatic cleanup

The result is a self-hosted platform that rivals commercial offerings while maintaining complete control and predictable costs.

For more details on specific components, see:
- [Architecture Overview](./architecture/ARCHITECTURE.md)
- [Core Concepts](./core-concepts/README.md)
- [System Patterns](../memory-bank/systemPatterns.md)
- [Tech Context](../memory-bank/techContext.md)
