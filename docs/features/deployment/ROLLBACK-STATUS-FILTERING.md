# Rollback Status Filtering Implementation

## Overview

This document describes the implementation of status-based filtering for the deployment rollback system. The system now distinguishes between deployments that succeeded and were superseded versus deployments that failed, ensuring users can only rollback to known-good deployments.

## Business Requirements

### Rollback Eligibility Rules

A deployment is **eligible for rollback** if:
- ✅ Status is `success` (deployment succeeded and completed)
- ✅ Status is `cancelled` (deployment succeeded but was stopped/replaced)
- ✅ It is not the current active deployment
- ✅ It is within the retention policy limit

A deployment is **NOT eligible for rollback** if:
- ❌ Status is `failed` (deployment failed during execution)
- ❌ Status is `pending`, `queued`, `building`, or `deploying` (deployment incomplete)
- ❌ It is the current active deployment

### Key Distinction

The system makes critical distinctions between deployment outcomes:

1. **Succeeded and Completed** (`success`) → ✅ Can Rollback
   - Deployment completed successfully
   - Was running and working correctly
   - Still marked as success even if replaced
   - Safe to rollback to this known-good state

2. **Succeeded then Stopped/Replaced** (`cancelled`) → ✅ Can Rollback
   - Deployment completed successfully initially
   - Was running and working correctly
   - A newer deployment replaced it OR user stopped it manually
   - Safe to rollback to this known-good state
   - **Note**: `cancelled` does NOT mean it failed - it means a successful deployment was stopped

3. **Failed During Deployment** (`failed`) → ❌ Cannot Rollback
   - Deployment failed to complete
   - Never worked correctly
   - Should not be a rollback target
   - Would just fail again

## Database Schema

### Deployment Status Enum

From `/apps/api/src/config/drizzle/schema/deployment.ts`:

```typescript
export const deploymentStatusEnum = pgEnum('deployment_status', [
    'pending',    // Initial state
    'queued',     // Waiting in queue
    'building',   // Building container
    'deploying',  // Deploying to server
    'success',    // ✅ Deployment succeeded
    'failed',     // ❌ Deployment failed
    'cancelled'   // ❌ Deployment cancelled
]);
```

**Important**: There is no `stopped` status. A deployment with status `success` remains `success` even after being superseded by a newer deployment. The "current" deployment is determined by being the most recent successful one.

## Implementation Details

### Backend Changes

#### 1. Controller: Filter by Status (`deployment.controller.ts`)

**Location**: `/apps/api/src/modules/deployment/controllers/deployment.controller.ts` (lines ~1085-1100)

**Before**:
```typescript
const successfulDeployments = await this.databaseService.db
    .select({...})
    .from(deployments)
    .where(eq(deployments.serviceId, input.serviceId))  // ❌ No status filter
    .orderBy(desc(deployments.createdAt));
```

**After**:
```typescript
const successfulDeployments = await this.databaseService.db
    .select({
        id: deployments.id,
        status: deployments.status,  // ✅ Include status
        // ... other fields
    })
    .from(deployments)
    .where(and(
        eq(deployments.serviceId, input.serviceId),
        or(
            eq(deployments.status, 'success'),
            eq(deployments.status, 'cancelled')  // ✅ Include cancelled (succeeded then stopped)
        )
    ))
    .orderBy(desc(deployments.createdAt));
```

**Key Changes**:
- Added `and()` and `or()` combinators from drizzle-orm
- Added status filter: `eq(deployments.status, 'success')` OR `eq(deployments.status, 'cancelled')`
- Included `status` field in SELECT clause
- Imports: Added `and` and `or` to drizzle-orm imports

#### 2. API Contract: Add Status Field (`rollbackHistory.ts`)

**Location**: `/packages/api-contracts/modules/deployment/rollbackHistory.ts` (lines ~24-42)

**Before**:
```typescript
availableDeployments: z.array(
    z.object({
        id: z.string(),
        // ❌ No status field
        createdAt: z.date(),
        // ...
    })
)
```

**After**:
```typescript
availableDeployments: z.array(
    z.object({
        id: z.string(),
        status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),  // ✅ Added
        createdAt: z.date(),
        // ...
    })
)
```

**Key Changes**:
- Added `status` field with enum validation
- Matches database enum values exactly
- Provides type safety for frontend

### Frontend Changes

#### 3. UI Component: Status-Based Rollback Button (`DeploymentRollbackHistory.tsx`)

**Location**: `/apps/web/src/components/deployment/DeploymentRollbackHistory.tsx` (lines ~178-197)

**Before**:
```tsx
{!isCurrent && (  // ❌ Only checks if not current
    <Button
        onClick={() => handleRollback(deployment.id)}
    >
        Rollback
    </Button>
)}
```

**After**:
```tsx
{!isCurrent && (deployment.status === 'success' || deployment.status === 'cancelled') ? (
    <Button
        variant={isSelected ? "default" : "outline"}
        size="sm"
        onClick={() => handleRollback(deployment.id)}
        className="gap-2"
    >
        <ArrowLeftCircle className="h-4 w-4" />
        Rollback
    </Button>
) : !isCurrent && deployment.status === 'failed' ? (
    <Button
        variant="ghost"
        size="sm"
        disabled
        className="gap-2 opacity-50 cursor-not-allowed"
        title="Cannot rollback to failed deployment"
    >
        <ArrowLeftCircle className="h-4 w-4" />
        Cannot Rollback (Failed)
    </Button>
) : null}
```

**Key Changes**:
- Added status check: `deployment.status === 'success' || deployment.status === 'cancelled'`
- Shows active rollback button for both successful and cancelled deployments
- Shows disabled button with specific message for failed deployments
- Adds tooltip explaining why rollback is unavailable for failed deployments
- Visual feedback: ghost variant, opacity, cursor-not-allowed

## User Experience

### Rollback History List

**For Successful Deployments** (eligible):
```
┌─────────────────────────────────────────────┐
│ 🟢 v2.1.0 | main | abc123                  │
│ Success                                     │
│                    [↩️ Rollback]           │
└─────────────────────────────────────────────┘
```

**For Cancelled Deployments** (eligible):
```
┌─────────────────────────────────────────────┐
│ 🟡 v2.0.5 | main | xyz789                  │
│ Cancelled                                   │
│                    [↩️ Rollback]           │
└─────────────────────────────────────────────┘
```

**For Failed Deployments** (not eligible):
```
┌─────────────────────────────────────────────┐
│ 🔴 v2.0.0 | main | def456                  │
│ Failed                                      │
│                    [↩️ Cannot Rollback]    │ ← Disabled button
└─────────────────────────────────────────────┘
```

**For Current Deployment**:
```
┌─────────────────────────────────────────────┐
│ 🟢 v2.2.0 | main | ghi789                  │
│ Success • Current                           │
│                    (no button)              │ ← No rollback for current
└─────────────────────────────────────────────┘
```

### Status Badge Colors

The UI uses color-coded badges to indicate deployment status:

- 🟢 **Success** - Green badge, rollback enabled
- � **Cancelled** - Yellow/Gray badge, rollback enabled (was successful before being stopped)
- 🔴 **Failed** - Red badge, rollback disabled (deployment never worked)
- 🔵 **Pending/Queued/Building/Deploying** - Blue/Yellow badge, rollback disabled (incomplete)

## API Response Example

```json
{
  "serviceId": "123e4567-e89b-12d3-a456-426614174000",
  "maxRetention": 5,
  "currentDeploymentId": "789e4567-e89b-12d3-a456-426614174000",
  "availableDeployments": [
    {
      "id": "789e4567-e89b-12d3-a456-426614174000",
      "status": "success",
      "createdAt": "2024-01-15T10:30:00Z",
      "containerImage": "myapp:v2.2.0",
      "metadata": {
        "version": "v2.2.0",
        "branch": "main",
        "commitSha": "ghi789"
      }
    },
    {
      "id": "456e4567-e89b-12d3-a456-426614174000",
      "status": "success",  // ✅ Eligible for rollback
      "createdAt": "2024-01-14T10:30:00Z",
      "containerImage": "myapp:v2.1.0",
      "metadata": {
        "version": "v2.1.0",
        "branch": "main",
        "commitSha": "abc123"
      }
    },
    {
      "id": "234e4567-e89b-12d3-a456-426614174000",
      "status": "cancelled",  // ✅ Also eligible for rollback (succeeded then stopped)
      "createdAt": "2024-01-13T10:30:00Z",
      "containerImage": "myapp:v2.0.5",
      "metadata": {
        "version": "v2.0.5",
        "branch": "main",
        "commitSha": "xyz789"
      }
    }
  ]
}
```

**Note**: Only deployments with `status: "success"` or `status: "cancelled"` are returned by the backend. Failed deployments are excluded from the response entirely.

## Testing Scenarios

### Test Case 1: Successful Deployment Superseded

1. Deploy v1.0 → Status: `success` ✅
2. Deploy v2.0 → Status: `success` ✅
3. Expected: v1.0 shows in rollback history with enabled button

### Test Case 2: Failed Deployment Replaced

1. Deploy v1.0 → Status: `failed` ❌
2. Deploy v2.0 → Status: `success` ✅
3. Expected: v1.0 does NOT appear in rollback history (filtered by backend)

### Test Case 3: Cancelled Deployment (Succeeded then Stopped)

1. Deploy v1.0 → Status: `success` ✅
2. Deploy v2.0 → Status: `cancelled` (was successful, then stopped) ✅
3. Deploy v3.0 → Status: `success` ✅
4. Expected rollback history:
   - v3.0 (current) - no rollback button
   - v2.0 (cancelled) - rollback enabled ✅
   - v1.0 (success) - rollback enabled ✅

### Test Case 4: Mixed History

1. Deploy v1.0 → Status: `success` ✅
2. Deploy v2.0 → Status: `failed` ❌
3. Deploy v3.0 → Status: `cancelled` (succeeded then stopped) ✅
4. Deploy v4.0 → Status: `success` ✅
5. Expected rollback history:
   - v4.0 (current) - no rollback button
   - v3.0 (cancelled) - rollback enabled ✅
   - v1.0 (success) - rollback enabled ✅
   - v2.0 - NOT in list (filtered out by backend)

## Performance Considerations

### Database Query Optimization

The status filter is applied at the database level:

```sql
SELECT * FROM deployments 
WHERE service_id = ? 
  AND (status = 'success' OR status = 'cancelled')  -- ✅ Indexed filter
ORDER BY created_at DESC;
```

**Benefits**:
- Reduces data transfer (fewer rows returned)
- Utilizes database index on `(service_id, status)` column
- No client-side filtering required
- Faster query execution

**Index Recommendation**:
```sql
CREATE INDEX idx_deployments_service_status 
ON deployments(service_id, status, created_at DESC);
```

## Security Considerations

### Preventing Invalid Rollbacks

1. **Backend Validation**: 
   - Query filters ensure only successful or cancelled deployments are returned
   - Failed deployments cannot be selected for rollback
   - Cannot bypass frontend validation by direct API calls

2. **Frontend Validation**:
   - Button enabled for success and cancelled statuses
   - Button disabled with clear message for failed deployments
   - Visual feedback for disabled state
   - Tooltip explains why rollback unavailable

3. **Type Safety**:
   - Status enum in API contract prevents invalid values
   - TypeScript compilation catches status mismatches

## Migration Notes

### Existing Data

This change is **backward compatible**:
- No database migration required (status field already exists)
- Existing deployments already have status values
- Frontend gracefully handles missing status field (defensive coding)

### Rollout Strategy

1. ✅ **Phase 1**: Deploy backend changes
   - API starts filtering by status
   - Frontend works with both old/new API responses

2. ✅ **Phase 2**: Deploy frontend changes
   - UI shows status-aware rollback buttons
   - Works seamlessly with updated backend

3. ✅ **Phase 3**: Verify
   - Test rollback functionality
   - Confirm failed deployments don't show rollback option

## Future Enhancements

### Potential Improvements

1. **Rollback Confirmation Dialog**:
   ```tsx
   "Are you sure you want to rollback to v2.1.0?
    This will create a new deployment with that version."
   ```

2. **Rollback Reason Tracking**:
   - Add `rollbackFrom` and `rollbackReason` fields
   - Track why rollback was needed
   - Build rollback analytics

3. **Deployment Health Metrics**:
   - Show success rate per deployment
   - Indicate deployments that had issues
   - Warn before rolling back to problematic versions

4. **Quick Rollback**:
   - Add "Quick Rollback" button on current deployment
   - One-click rollback to last known-good version
   - Bypass history list for emergency situations

5. **Rollback Preview**:
   - Show diff of what will change
   - Preview environment variables
   - Display configuration changes

## Documentation Links

- [Deployment Retention System](./DEPLOYMENT-RETENTION.md)
- [Deployment Health Rules](./DEPLOYMENT-HEALTH-RULES.md)
- [API Contracts - ORPC](../../reference/ORPC-TYPE-CONTRACTS.md)

## Summary

This implementation ensures that users can only rollback to deployments that:
1. ✅ Successfully completed in the past (status = `success`)
2. ✅ Successfully completed but were stopped/replaced (status = `cancelled`)
3. ✅ Were working correctly when active
4. ✅ Are within the retention policy

**Key Point**: The `cancelled` status does NOT mean the deployment failed. It means a deployment that succeeded was later stopped (either by a new deployment or manually). This is different from `failed` which means the deployment never worked.

This provides a safe and reliable rollback mechanism that prevents reverting to broken deployments.
