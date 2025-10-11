# Static Deployment Status Bug Fix

## Problem Description

**Bug:** Static deployments that successfully completed were being incorrectly changed from `status='success'` to `status='pending'` by the health monitoring system.

**Symptom:** After a static site deployment completed successfully, the deployment status would revert to "pending" within minutes, even though the site was working correctly.

## Root Cause Analysis

The issue was caused by two interconnected problems in the health monitoring system:

### 1. Health Monitor Including Static Deployments

**File:** `apps/api/src/core/services/deployment-health-monitor.service.ts`

The health monitor was checking ALL deployments with `status IN ('success', 'deploying')`, including static deployments that have no Docker containers.

```typescript
// BEFORE (Bug):
const activeDeployments = await this.databaseService.db
    .select()
    .from(deployments)
    .where(inArray(deployments.status, ['success', 'deploying']));

// Monitored ALL deployments, including static ones without containers
```

### 2. Unknown Health Status → Pending Status

**File:** `apps/api/src/core/services/deployment.service.ts`

When the health monitor checked a static deployment:
- It found **no containers** (static sites don't use Docker containers)
- It returned `status: 'unknown'` (line 1069)
- The `updateDeploymentHealthStatus` function mapped `'unknown'` → `'pending'` (line 1166)
- This **overwrote** the successful `'success'` status

```typescript
// BEFORE (Bug):
switch (status) {
    case 'healthy':
        deploymentStatus = 'success';
        break;
    case 'degraded':
    case 'unhealthy':
        deploymentStatus = 'failed';
        break;
    default:
        deploymentStatus = 'pending'; // ❌ BUG: Overwrites 'success' for static deployments
}
```

## The Fix

### Fix 1: Exclude Static Deployments from Health Monitoring

**File:** `apps/api/src/core/services/deployment-health-monitor.service.ts`

Filter out deployments without containers before monitoring:

```typescript
// AFTER (Fixed):
const activeDeployments = await this.databaseService.db
    .select({
        id: deployments.id,
        serviceId: deployments.serviceId,
        status: deployments.status,
        containerName: deployments.containerName,
    })
    .from(deployments)
    .where(inArray(deployments.status, ['success', 'deploying']));

// Filter out deployments without containers (static sites)
const deploymentsWithContainers = activeDeployments.filter(
    deployment => deployment.containerName !== null && deployment.containerName !== ''
);

// Only monitor deployments that have containers
const healthPromises = deploymentsWithContainers.map(deployment => 
    this.checkDeploymentHealth(deployment.id)
);
```

**Benefits:**
- Static deployments are completely skipped by the health monitor
- Reduces unnecessary health checks
- Logs show how many static vs containerized deployments exist

### Fix 2: Preserve Success Status for Unknown Health

**File:** `apps/api/src/core/services/deployment.service.ts`

Don't downgrade `'success'` to `'pending'` when health status is `'unknown'`:

```typescript
// AFTER (Fixed):
private async updateDeploymentHealthStatus(...) {
    try {
        // Get current deployment status to avoid incorrectly downgrading
        const [currentDeployment] = await this.databaseService.db
            .select({ status: deployments.status })
            .from(deployments)
            .where(eq(deployments.id, deploymentId))
            .limit(1);

        let deploymentStatus: ...;
        switch (status) {
            case 'healthy':
                deploymentStatus = 'success';
                break;
            case 'degraded':
            case 'unhealthy':
                deploymentStatus = 'failed';
                break;
            case 'unknown':
            default:
                // ✅ FIX: Don't downgrade 'success' to 'pending'
                if (currentDeployment?.status === 'success') {
                    this.logger.debug(
                        `Deployment ${deploymentId} has unknown health but keeping success status`
                    );
                    return; // Don't update status
                }
                deploymentStatus = 'pending';
        }
        // ... rest of function
    }
}
```

**Benefits:**
- Provides a safety net even if static deployments slip through
- Protects against similar bugs in the future
- Logs when this protection is triggered

## Deployment Types and Container Status

### Containerized Deployments
- **Docker/Dockerfile:** ✅ Have containers, should be monitored
- **Nixpack/Buildpack:** ✅ Have containers, should be monitored
- **Docker Compose:** ✅ Have containers, should be monitored

### Non-Containerized Deployments
- **Static Sites:** ❌ No containers, skip monitoring
- **Manual Deployments:** ❌ May not have containers, skip if no containerName

## Testing the Fix

### 1. Verify Static Deployment Status Persists

```bash
# Deploy a static site
curl -X POST http://localhost:3001/api/deployments \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "static-demo-service-id",
    "environment": "production"
  }'

# Check status immediately after success
curl http://localhost:3001/api/deployments/{deploymentId}
# Should show: "status": "success"

# Wait 2-3 minutes (for health monitor cycle)
# Check status again
curl http://localhost:3001/api/deployments/{deploymentId}
# Should STILL show: "status": "success" ✅
```

### 2. Check Health Monitor Logs

```bash
docker logs deployer-api-dev 2>&1 | grep -i "static deployment"
```

Expected output:
```
Skipping 1 static deployments (no containers), monitoring 3 containerized deployments
```

### 3. Verify Containerized Deployments Still Monitored

Ensure Docker-based deployments are still being health-checked:

```bash
docker logs deployer-api-dev 2>&1 | grep "Health check completed"
```

## Related Documentation

- **Deployment Health Rules:** `docs/DEPLOYMENT-HEALTH-RULES.md`
- **Static File Service:** `apps/api/src/core/services/static-file.service.ts`
- **Deployment Processor:** `apps/api/src/core/modules/orchestration/processors/deployment.processor.ts`

## Impact

### Before Fix
- ❌ Static deployments incorrectly marked as "pending" every 2 minutes
- ❌ Frontend showed incorrect status for static sites
- ❌ Health rollback policy couldn't work correctly
- ❌ Unnecessary health checks on static deployments

### After Fix
- ✅ Static deployments maintain "success" status correctly
- ✅ Frontend shows accurate deployment status
- ✅ Health monitor only checks containerized deployments
- ✅ Reduced unnecessary processing

## Future Considerations

1. **Service Type Tracking:** Consider adding a `deploymentType` field to distinguish static vs containerized deployments more explicitly
2. **Static Health Checks:** Implement HTTP-only health checks for static sites (no container required)
3. **Builder-Based Filtering:** Use `service.builder === 'static'` for more reliable filtering
4. **Status Audit Trail:** Track status changes with timestamps to detect similar issues

## Commit Reference

This fix addresses the issue where successful static deployments were being incorrectly reverted to "pending" status by the automated health monitoring system.

**Files Changed:**
- `apps/api/src/core/services/deployment.service.ts`
- `apps/api/src/core/services/deployment-health-monitor.service.ts`

**Key Changes:**
1. Filter out deployments without `containerName` from health monitoring
2. Preserve `'success'` status when health returns `'unknown'`
3. Add logging for skipped static deployments
