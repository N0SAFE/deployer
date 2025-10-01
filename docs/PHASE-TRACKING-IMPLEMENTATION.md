# Deployment Phase Tracking Implementation

> **Status:** Phase 1.1-1.2 Complete ✅  
> **Date:** 30 September 2025

## Overview

Implemented comprehensive deployment phase tracking to enable:
- Real-time deployment progress monitoring
- Crash recovery and resume capabilities
- Stuck deployment detection
- Detailed deployment lifecycle visibility

## Architecture

### Database Schema

Enhanced `deployments` table with reconciliation columns:

```sql
ALTER TABLE deployments ADD COLUMN phase VARCHAR(50) DEFAULT 'queued';
ALTER TABLE deployments ADD COLUMN phase_progress INTEGER DEFAULT 0;
ALTER TABLE deployments ADD COLUMN phase_metadata JSONB DEFAULT '{}';
ALTER TABLE deployments ADD COLUMN phase_updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX idx_deployments_stuck ON deployments(status, phase_updated_at);
```

Enhanced `projects` table for health tracking:

```sql
ALTER TABLE projects ADD COLUMN metadata JSONB DEFAULT '{}';
```

### Deployment Lifecycle Phases

```typescript
export enum DeploymentPhase {
  QUEUED = 'queued',           // Initial state
  PULLING_SOURCE = 'pulling_source',  // Fetching source code
  BUILDING = 'building',        // Building application
  COPYING_FILES = 'copying_files',    // Copying to volume
  CREATING_SYMLINKS = 'creating_symlinks',  // Symlink creation
  UPDATING_ROUTES = 'updating_routes',      // Traefik updates
  HEALTH_CHECK = 'health_check',      // Health verification
  ACTIVE = 'active',           // Successfully deployed
  FAILED = 'failed',           // Deployment failed
}
```

### Phase Metadata Structure

```typescript
export interface PhaseMetadata {
  // Source code metadata
  sourceCommit?: string;
  uploadId?: string;
  
  // File operation metadata
  filesCopied?: number;
  totalFiles?: number;
  
  // Container metadata
  containerId?: string;
  
  // Deployment type metadata
  deploymentType?: string;
  detectedType?: string;
  
  // Error metadata
  error?: string;
  stack?: string;
  
  // Allow additional custom metadata
  [key: string]: any;
}
```

## Implementation

### DeploymentService Enhancement

Added `updateDeploymentPhase()` method:

```typescript
async updateDeploymentPhase(
  deploymentId: string,
  phase: DeploymentPhase,
  progress: number = 0,
  metadata: PhaseMetadata = {}
): Promise<void> {
  this.logger.log(`Updating deployment ${deploymentId} phase to ${phase} (${progress}%)`);
  
  await db
    .update(deployments)
    .set({
      phase,
      phaseProgress: progress,
      phaseMetadata: metadata,
      phaseUpdatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(deployments.id, deploymentId));
  
  // Log phase transition
  await this.addDeploymentLog(deploymentId, {
    level: 'info',
    message: `Phase transition: ${phase} (${progress}%)`,
    phase,
    timestamp: new Date(),
    metadata,
  });
}
```

### Upload Deployment Flow Integration

Phase tracking integrated into upload deployment processor:

```typescript
// Phase 1: PULLING_SOURCE
await this.deploymentService.updateDeploymentPhase(
  deploymentId,
  DeploymentPhase.PULLING_SOURCE,
  10,
  { uploadId }
);

// Phase 2: BUILDING
await this.deploymentService.updateDeploymentPhase(
  deploymentId,
  DeploymentPhase.BUILDING,
  30,
  { detectedType: uploadInfo.metadata.detectedType }
);

// Phase 3: COPYING_FILES
await this.deploymentService.updateDeploymentPhase(
  deploymentId,
  DeploymentPhase.COPYING_FILES,
  50,
  { deploymentType: 'static' }
);

// Phase 4: ACTIVE (success)
await this.deploymentService.updateDeploymentPhase(
  deploymentId,
  DeploymentPhase.ACTIVE,
  100,
  {
    deploymentType: uploadInfo.metadata.detectedType,
    completedAt: new Date().toISOString(),
    ...deploymentResult,
  }
);

// Or FAILED (error)
await this.deploymentService.updateDeploymentPhase(
  deploymentId,
  DeploymentPhase.FAILED,
  0,
  {
    error: err.message,
    stack: err.stack,
    failedAt: new Date().toISOString(),
  }
);
```

## Features Enabled

### 1. Real-time Progress Tracking
- Each deployment now reports its current phase and progress percentage
- Frontend can display live deployment status
- Clear visibility into what's happening during deployment

### 2. Stuck Deployment Detection
```sql
-- Find deployments stuck for more than 5 minutes
SELECT * FROM deployments 
WHERE status IN ('building', 'deploying') 
  AND phase_updated_at < NOW() - INTERVAL '5 minutes';
```

### 3. Resume Capability Foundation
- Phase tracking enables resuming deployments from last successful phase
- Metadata provides context for idempotent phase retry
- Future: `resumeFromPhase()` can pick up where deployment stopped

### 4. Deployment Analytics
- Track which phases take longest
- Identify common failure points
- Monitor deployment health trends

## Usage Examples

### Query Current Deployment Status

```typescript
const deployment = await db
  .select()
  .from(deployments)
  .where(eq(deployments.id, deploymentId))
  .limit(1);

console.log(`Phase: ${deployment.phase} (${deployment.phaseProgress}%)`);
console.log(`Metadata:`, deployment.phaseMetadata);
```

### Monitor Deployment Progress

```typescript
// WebSocket or polling endpoint
async getDeploymentProgress(deploymentId: string) {
  const deployment = await db
    .select({
      phase: deployments.phase,
      progress: deployments.phaseProgress,
      metadata: deployments.phaseMetadata,
      updatedAt: deployments.phaseUpdatedAt,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  
  return deployment[0];
}
```

### Find Stuck Deployments

```typescript
async findStuckDeployments() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  
  return db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.status, 'building'),
        lt(deployments.phaseUpdatedAt, fiveMinutesAgo)
      )
    );
}
```

## Next Steps

### Phase 1.3: Container Health Checks
- Add Docker healthcheck configuration
- Implement RestartPolicy for auto-recovery
- Create health check command generator

### Phase 1.4: Health Monitoring Service
- Cron job to check container health every 30s
- Auto-restart unhealthy containers
- Alert on frequent restart loops

### Phase 2: Crash Recovery
- Implement `resumeIncompleteDeployments()` in ZombieCleanupService
- Add idempotency checks for each phase
- Enable deployment resume after API crash

### Phase 3: Multi-Server Coordination
- PostgreSQL advisory locks for leader election
- Distributed reconciliation with leadership
- Prevent duplicate cleanup operations

## Testing

### Manual Testing Steps

1. **Start a deployment:**
   ```bash
   # Upload a file and trigger deployment
   curl -X POST http://localhost:3001/api/deployments
   ```

2. **Monitor phase transitions:**
   ```sql
   SELECT id, phase, phase_progress, phase_metadata, phase_updated_at 
   FROM deployments 
   ORDER BY created_at DESC 
   LIMIT 1;
   ```

3. **Check deployment logs:**
   ```sql
   SELECT * FROM deployment_logs 
   WHERE deployment_id = 'xxx' 
   ORDER BY timestamp DESC;
   ```

4. **Verify stuck detection:**
   ```bash
   # Kill API during deployment
   docker-compose stop api
   # Wait 5 minutes
   # Query stuck deployments
   ```

### Automated Tests (TODO)

- [ ] Test phase progression through complete deployment
- [ ] Test phase metadata capture
- [ ] Test FAILED phase on error
- [ ] Test stuck deployment detection
- [ ] Test phase transition logging

## Migration

### Development Environment
- Migrations auto-apply on API restart
- No manual intervention needed
- Schema changes already in deployment.ts

### Production Environment
- Run `bun run api -- db:migrate` before deployment
- Verify schema with `bun run api -- db:studio`
- Monitor logs during migration

## Performance Impact

- **Database:** Minimal - 4 additional columns, 1 index
- **Write Load:** +1 write per phase transition (4-6 per deployment)
- **Storage:** ~1KB per deployment for phase_metadata JSONB
- **Query Performance:** Indexed queries for stuck deployments remain fast

## Related Documentation

- [RECONCILIATION-ARCHITECTURE.md](./RECONCILIATION-ARCHITECTURE.md) - Overall architecture patterns
- [RECONCILIATION-IMPLEMENTATION-GUIDE.md](./RECONCILIATION-IMPLEMENTATION-GUIDE.md) - Step-by-step guide
- [RECONCILIATION-TODO.md](./RECONCILIATION-TODO.md) - Complete task checklist
- [DEVELOPMENT-WORKFLOW.md](./DEVELOPMENT-WORKFLOW.md) - Database migration workflow
