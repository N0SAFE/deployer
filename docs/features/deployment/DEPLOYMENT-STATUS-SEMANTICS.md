# Deployment Status Semantics

## Overview

This document clarifies the meaning of deployment statuses in the system, particularly the distinction between `cancelled` and `failed`, which is critical for the rollback functionality.

## Status Definitions

### ✅ Success Statuses (Rollback Eligible)

#### `success`
**Definition**: Deployment completed successfully and is currently active.

**Characteristics**:
- ✅ Deployment process completed without errors
- ✅ Application is running and accessible
- ✅ All health checks passed
- ✅ Container is up and responding

**Lifecycle**:
```
pending → queued → building → deploying → success
```

**Can rollback to this**: YES ✅

**Example**:
```json
{
  "id": "abc123",
  "status": "success",
  "createdAt": "2024-01-15T10:00:00Z",
  "containerName": "myapp-v2.1.0",
  "containerImage": "myapp:v2.1.0"
}
```

---

#### `cancelled`
**Definition**: Deployment that **succeeded initially** but was later stopped or replaced.

**Characteristics**:
- ✅ Deployment originally completed successfully
- ✅ Was running and working correctly at some point
- ✅ Later stopped by one of these actions:
  - A newer deployment replaced it
  - User manually stopped the deployment
  - System automatically stopped it (cleanup, scaling, etc.)
- ⚠️ **NOT the same as failed** - it DID work before being stopped

**Lifecycle**:
```
success → (replaced by new deployment) → cancelled
success → (user stops deployment) → cancelled
success → (system stops deployment) → cancelled
```

**Can rollback to this**: YES ✅ (it worked before!)

**Example**:
```json
{
  "id": "def456",
  "status": "cancelled",
  "createdAt": "2024-01-14T10:00:00Z",
  "containerName": "myapp-v2.0.5",
  "containerImage": "myapp:v2.0.5",
  "metadata": {
    "cancelledAt": "2024-01-15T10:00:00Z",
    "cancelledBy": "newer deployment abc123"
  }
}
```

**Real-world scenarios where deployment becomes cancelled**:

1. **Deployment Superseded**:
   ```
   1. Deploy v2.0.0 → Status: success ✅
   2. Deploy v2.1.0 → Status: success ✅
   3. v2.0.0 automatically stopped → Status: cancelled ✅
      (v2.0.0 worked fine, just replaced by newer version)
   ```

2. **Manual Stop**:
   ```
   1. Deploy v2.0.0 → Status: success ✅
   2. User clicks "Stop" button
   3. v2.0.0 stopped → Status: cancelled ✅
      (v2.0.0 worked fine, user just stopped it)
   ```

3. **Scaling Down**:
   ```
   1. Multiple deployments running
   2. System scales down to reduce resource usage
   3. Some deployments stopped → Status: cancelled ✅
      (Deployments worked fine, just not needed anymore)
   ```

---

### ❌ Failure Statuses (NOT Rollback Eligible)

#### `failed`
**Definition**: Deployment that **failed during execution** and never worked correctly.

**Characteristics**:
- ❌ Deployment process encountered errors
- ❌ Never reached a working state
- ❌ Container failed to start or crashed immediately
- ❌ Health checks never passed
- ❌ Configuration errors, missing dependencies, etc.

**Lifecycle**:
```
pending → queued → building → deploying → failed
pending → queued → building → failed
pending → queued → failed
```

**Can rollback to this**: NO ❌ (it never worked!)

**Example**:
```json
{
  "id": "ghi789",
  "status": "failed",
  "createdAt": "2024-01-13T10:00:00Z",
  "containerImage": "myapp:v1.9.0",
  "error": "Container failed to start: port 3000 already in use"
}
```

**Real-world scenarios where deployment fails**:

1. **Build Failure**:
   ```
   1. Deploy v1.9.0 → Building...
   2. NPM install fails → Status: failed ❌
      (Never got to running state)
   ```

2. **Container Crash**:
   ```
   1. Deploy v1.9.0 → Deploying...
   2. Container starts but immediately crashes
   3. Status: failed ❌
      (Never worked correctly)
   ```

3. **Configuration Error**:
   ```
   1. Deploy v1.9.0 → Deploying...
   2. Missing environment variable
   3. Application won't start → Status: failed ❌
      (Configuration problem, never worked)
   ```

---

### 🔄 In-Progress Statuses (NOT Rollback Eligible)

#### `pending`
**Definition**: Deployment created but not yet started.
**Can rollback to this**: NO ❌ (not finished yet)

#### `queued`
**Definition**: Deployment waiting in queue to be processed.
**Can rollback to this**: NO ❌ (not finished yet)

#### `building`
**Definition**: Building Docker image or compiling application.
**Can rollback to this**: NO ❌ (not finished yet)

#### `deploying`
**Definition**: Actively deploying to server, starting containers.
**Can rollback to this**: NO ❌ (not finished yet)

---

## Critical Distinction: `cancelled` vs `failed`

### Visual Comparison

```
✅ SUCCEEDED THEN CANCELLED (Can Rollback)
┌──────────────────────────────────────┐
│  Deployment v2.0.0                   │
│  ✓ Build successful                  │
│  ✓ Container started                 │
│  ✓ Health checks passed              │
│  ✓ Served traffic successfully       │
│  ✓ Worked for hours/days             │
│  ⚠️ Then: Replaced by v2.1.0         │
│  Status: cancelled                   │
│  Rollback: ALLOWED ✅                │
└──────────────────────────────────────┘
```

```
❌ FAILED (Cannot Rollback)
┌──────────────────────────────────────┐
│  Deployment v1.9.0                   │
│  ✓ Build successful                  │
│  ✗ Container failed to start         │
│  ✗ Health checks never passed        │
│  ✗ Never served any traffic          │
│  ✗ Error: Port already in use        │
│  Status: failed                      │
│  Rollback: BLOCKED ❌                │
└──────────────────────────────────────┘
```

### Key Question to Determine Status

**"Did the deployment ever work correctly?"**

- **YES** → `success` (if still running) or `cancelled` (if stopped)
- **NO** → `failed`

### Rollback Decision Matrix

| Previous Status | Was It Working? | Can Rollback? | Reason |
|----------------|-----------------|---------------|---------|
| `success` | Yes ✅ | Yes ✅ | Known good state |
| `cancelled` | Yes ✅ | Yes ✅ | Was working before being stopped |
| `failed` | No ❌ | No ❌ | Never worked, would fail again |
| `pending` | N/A | No ❌ | Incomplete |
| `queued` | N/A | No ❌ | Incomplete |
| `building` | N/A | No ❌ | Incomplete |
| `deploying` | N/A | No ❌ | Incomplete |

---

## Backend Implementation

### Database Query
```typescript
// Fetch deployments eligible for rollback
const eligibleDeployments = await db
    .select()
    .from(deployments)
    .where(and(
        eq(deployments.serviceId, serviceId),
        or(
            eq(deployments.status, 'success'),    // ✅ Currently working
            eq(deployments.status, 'cancelled')   // ✅ Worked before being stopped
        )
    ))
    .orderBy(desc(deployments.createdAt));
```

### Status Transition Logic

**When does a deployment become `cancelled`?**

1. **New Deployment Replaces It**:
```typescript
async function deployNewVersion(serviceId: string) {
    // Stop current deployment
    const currentDeployment = await getCurrentDeployment(serviceId);
    if (currentDeployment.status === 'success') {
        await updateStatus(currentDeployment.id, 'cancelled', {
            reason: 'Replaced by new deployment',
            cancelledBy: newDeploymentId
        });
    }
    
    // Start new deployment
    await startDeployment(newDeploymentId);
}
```

2. **User Stops Deployment**:
```typescript
async function stopDeployment(deploymentId: string) {
    const deployment = await getDeployment(deploymentId);
    
    if (deployment.status === 'success') {
        // It was working, mark as cancelled
        await updateStatus(deploymentId, 'cancelled', {
            reason: 'Stopped by user',
            cancelledBy: userId,
            cancelledAt: new Date()
        });
    }
}
```

**When does a deployment become `failed`?**

```typescript
async function handleDeploymentError(deploymentId: string, error: Error) {
    const deployment = await getDeployment(deploymentId);
    
    // Never reached success, mark as failed
    if (['pending', 'queued', 'building', 'deploying'].includes(deployment.status)) {
        await updateStatus(deploymentId, 'failed', {
            error: error.message,
            failedAt: new Date(),
            reason: 'Deployment process failed'
        });
    }
}
```

---

## Frontend Implementation

### Rollback Button Logic

```tsx
// Enable rollback for success and cancelled (both worked at some point)
{!isCurrent && (deployment.status === 'success' || deployment.status === 'cancelled') ? (
    <Button onClick={() => rollback(deployment.id)}>
        <ArrowLeftCircle /> Rollback
    </Button>
) : !isCurrent && deployment.status === 'failed' ? (
    <Button disabled title="Cannot rollback to failed deployment">
        <ArrowLeftCircle /> Cannot Rollback (Failed)
    </Button>
) : null}
```

### Status Badge Colors

```tsx
function getStatusBadgeColor(status: DeploymentStatus) {
    switch (status) {
        case 'success':
            return 'bg-green-100 text-green-800';  // 🟢 Green - Working
        
        case 'cancelled':
            return 'bg-gray-100 text-gray-800';    // ⚪ Gray - Stopped (but worked)
        
        case 'failed':
            return 'bg-red-100 text-red-800';      // 🔴 Red - Never worked
        
        case 'building':
        case 'deploying':
            return 'bg-blue-100 text-blue-800';    // 🔵 Blue - In progress
        
        case 'pending':
        case 'queued':
            return 'bg-yellow-100 text-yellow-800'; // 🟡 Yellow - Waiting
    }
}
```

---

## Common Misconceptions

### ❌ Misconception 1: "Cancelled means failed"
**Reality**: `cancelled` means the deployment succeeded but was later stopped. It's eligible for rollback.

### ❌ Misconception 2: "Can't rollback to cancelled deployments"
**Reality**: You CAN and SHOULD be able to rollback to cancelled deployments because they worked correctly.

### ❌ Misconception 3: "All non-success deployments are bad"
**Reality**: Only `failed` deployments never worked. `cancelled` deployments worked fine.

### ❌ Misconception 4: "Status never changes after deployment completes"
**Reality**: Status can change from `success` to `cancelled` when stopped/replaced.

---

## User Education

### Help Text in UI

**Rollback History Section**:
```
About Rollback History:
• Success ✅: Deployments currently working
• Cancelled ⚪: Deployments that worked but were stopped
• Failed ❌: Deployments that never worked
• You can rollback to both Success and Cancelled deployments
• Failed deployments are not shown (they never worked)
```

### Tooltip Explanations

**For Cancelled Status**:
```
This deployment succeeded and was working correctly.
It was later stopped when a newer version was deployed.
You can safely rollback to this version.
```

**For Failed Status**:
```
This deployment failed during execution and never worked.
Rolling back to this version would fail again.
```

---

## Testing Scenarios

### Scenario 1: Successful Replacement
```
1. Deploy v1.0 → success ✅
2. v1.0 runs for 2 hours
3. Deploy v2.0 → success ✅
4. v1.0 automatically stopped → cancelled ✅
5. Result: Can rollback to v1.0 (it worked for 2 hours)
```

### Scenario 2: Failed Then Fixed
```
1. Deploy v1.0 → failed ❌ (port conflict)
2. Fix configuration
3. Deploy v1.0 again → success ✅
4. Result: Cannot rollback to first v1.0 (failed), can rollback to second v1.0 (succeeded)
```

### Scenario 3: Manual Stop
```
1. Deploy v1.0 → success ✅
2. v1.0 runs successfully
3. User clicks "Stop" → cancelled ✅
4. Result: Can rollback to v1.0 (it was working)
```

---

## Summary

**Status Semantics**:
- `success` = Currently working ✅
- `cancelled` = Was working, then stopped ✅
- `failed` = Never worked ❌

**Rollback Eligibility**:
- ✅ `success`: YES - it's working now
- ✅ `cancelled`: YES - it worked before
- ❌ `failed`: NO - it never worked

**Key Principle**:
> "We only rollback to deployments that have proven they can work correctly."

This ensures safe rollbacks that restore known-good states, not broken ones.
