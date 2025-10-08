# Deployment Retention and Rollback System

> Part of the Docker-first SaaS workflow: automatic management of deployment history with configurable retention policies for efficient rollback capabilities.

This document explains the deployment retention system that automatically manages deployment history and enables safe rollback operations.

## Overview

The deployment retention system provides:
- **Configurable Retention**: Keep N most recent successful deployments per service
- **Automatic Cleanup**: Automatically removes old deployments after each successful deployment
- **Artifact Management**: Optionally preserve or delete Docker images and static files
- **Rollback History**: API to retrieve available deployments for rollback
- **Preview Mode**: See what would be deleted before triggering cleanup
- **Manual Control**: Override automatic cleanup with manual triggers

## Configuration

### Service-Level Retention Policy

Each service has a `deploymentRetention` configuration with three parameters:

```typescript
{
  maxSuccessfulDeployments: number  // Number of successful deployments to keep (default: 5)
  keepArtifacts: boolean            // Preserve Docker images/files (default: true)
  autoCleanup: boolean              // Automatically cleanup after deployment (default: true)
}
```

### Default Configuration

When a service is created, it uses these defaults:
- **maxSuccessfulDeployments**: 5 deployments
- **keepArtifacts**: true (preserve images and files)
- **autoCleanup**: true (automatic cleanup enabled)

## How It Works

### Automatic Cleanup Flow

1. **Deployment Success**: When a deployment succeeds
2. **Trigger Cleanup**: System automatically triggers cleanup (if `autoCleanup: true`)
3. **Query Deployments**: Gets all successful deployments for the service
4. **Sort by Date**: Orders deployments by creation date (newest first)
5. **Apply Retention**: Keeps N most recent, marks older ones for deletion
6. **Delete Records**: Removes old deployment records from database
7. **Cleanup Artifacts**: Optionally removes Docker images and static files (based on `keepArtifacts`)

### Cleanup Strategy

The cleanup service respects the retention policy and handles both deployment types:

#### Containerized Deployments (Docker)
- **keepArtifacts: true**
  - Stops and removes old containers
  - Preserves Docker images
  - Deployment remains available for inspection

- **keepArtifacts: false**
  - Stops and removes old containers
  - Removes Docker images
  - Frees up disk space

#### Static Deployments
- **keepArtifacts: true**
  - Preserves static file directories
  - Files remain accessible for reference

- **keepArtifacts: false**
  - Removes static file directories
  - Frees up disk space

### Error Handling

The cleanup system is designed to be resilient:
- **Non-Blocking**: Cleanup runs asynchronously, doesn't block deployment success
- **Graceful Degradation**: Individual cleanup failures are logged but don't stop the process
- **Continued Execution**: If one deployment's cleanup fails, continues with others
- **Warning Logs**: Failed cleanups are logged at warning level for investigation

## API Endpoints

### 1. Get Rollback History

Retrieve the list of successful deployments available for rollback.

**Endpoint**: `GET /api/deployment/rollback-history`

**Request**:
```json
{
  "serviceId": "service-uuid"
}
```

**Response**:
```json
{
  "serviceId": "service-uuid",
  "maxRetention": 5,
  "currentDeploymentId": "current-deployment-uuid",
  "availableDeployments": [
    {
      "id": "deployment-uuid-1",
      "version": "v1.2.3",
      "branch": "main",
      "commitSha": "abc123def456",
      "status": "success",
      "createdAt": "2025-10-02T10:00:00Z"
    },
    {
      "id": "deployment-uuid-2",
      "version": "v1.2.2",
      "branch": "main",
      "commitSha": "def456abc123",
      "status": "success",
      "createdAt": "2025-10-01T10:00:00Z"
    }
    // ... up to maxRetention deployments
  ]
}
```

### 2. Preview Cleanup

Preview what would be deleted without actually performing the cleanup.

**Endpoint**: `GET /api/deployment/preview-cleanup`

**Request**:
```json
{
  "serviceId": "service-uuid"
}
```

**Response**:
```json
{
  "willDelete": 3,
  "willKeep": 5,
  "deploymentsToDelete": [
    {
      "id": "deployment-uuid-6",
      "version": "v1.1.8",
      "createdAt": "2025-09-25T10:00:00Z"
    },
    {
      "id": "deployment-uuid-7",
      "version": "v1.1.7",
      "createdAt": "2025-09-24T10:00:00Z"
    },
    {
      "id": "deployment-uuid-8",
      "version": "v1.1.6",
      "createdAt": "2025-09-23T10:00:00Z"
    }
  ],
  "deploymentsToKeep": [
    {
      "id": "deployment-uuid-1",
      "version": "v1.2.3",
      "createdAt": "2025-10-02T10:00:00Z"
    }
    // ... 4 more deployments
  ]
}
```

### 3. Trigger Manual Cleanup

Manually trigger cleanup for a service (useful when `autoCleanup: false`).

**Endpoint**: `POST /api/deployment/trigger-cleanup`

**Request**:
```json
{
  "serviceId": "service-uuid"
}
```

**Response**:
```json
{
  "success": true,
  "deletedCount": 3,
  "keptCount": 5,
  "message": "Successfully cleaned up 3 old deployments for service my-service",
  "deletedDeployments": [
    {
      "id": "deployment-uuid-6",
      "version": "v1.1.8"
    },
    {
      "id": "deployment-uuid-7",
      "version": "v1.1.7"
    },
    {
      "id": "deployment-uuid-8",
      "version": "v1.1.6"
    }
  ]
}
```

### 4. Update Retention Policy

Update the retention policy for a service.

**Endpoint**: `PATCH /api/deployment/retention-policy`

**Request**:
```json
{
  "serviceId": "service-uuid",
  "maxSuccessfulDeployments": 10,
  "keepArtifacts": false,
  "autoCleanup": true
}
```

**Response**:
```json
{
  "success": true,
  "retentionPolicy": {
    "maxSuccessfulDeployments": 10,
    "keepArtifacts": false,
    "autoCleanup": true
  },
  "message": "Retention policy updated successfully"
}
```

## Usage Examples

### Example 1: Standard Configuration (Default)

**Scenario**: Keep 5 deployments, preserve artifacts, automatic cleanup

```json
{
  "maxSuccessfulDeployments": 5,
  "keepArtifacts": true,
  "autoCleanup": true
}
```

**Behavior**:
- After each successful deployment, old deployments beyond 5 are automatically removed
- Docker images and static files are preserved
- No manual intervention needed

### Example 2: Aggressive Cleanup

**Scenario**: Keep only 3 deployments, delete artifacts to save space

```json
{
  "maxSuccessfulDeployments": 3,
  "keepArtifacts": false,
  "autoCleanup": true
}
```

**Behavior**:
- Only 3 most recent successful deployments are kept
- Docker images and static files are deleted for old deployments
- Maximizes disk space efficiency

### Example 3: Manual Control

**Scenario**: Keep 10 deployments, manual cleanup only

```json
{
  "maxSuccessfulDeployments": 10,
  "keepArtifacts": true,
  "autoCleanup": false
}
```

**Behavior**:
- Up to 10 deployments are kept (no automatic deletion)
- Must manually trigger cleanup via API
- Useful for services where you want explicit control

### Example 4: Long-Term Retention

**Scenario**: Keep many deployments for audit/compliance

```json
{
  "maxSuccessfulDeployments": 50,
  "keepArtifacts": true,
  "autoCleanup": true
}
```

**Behavior**:
- Keeps 50 most recent successful deployments
- All artifacts preserved for rollback or audit
- Automatic cleanup prevents unlimited growth

## Rollback Integration

The retention system integrates with rollback functionality:

1. **Query Available Deployments**: Use `getRollbackHistory` endpoint
2. **Select Deployment**: Choose from available deployments within retention policy
3. **Trigger Rollback**: Rollback to selected deployment
4. **Preserved Artifacts**: If `keepArtifacts: true`, images/files are available immediately

## Best Practices

### Choosing maxSuccessfulDeployments

- **Development/Staging**: 3-5 deployments (fast iteration, less history needed)
- **Production**: 10-20 deployments (more history for safe rollbacks)
- **Critical Services**: 20-50 deployments (extensive audit trail)
- **Storage Constrained**: 3 deployments (minimize disk usage)

### Choosing keepArtifacts

- **Set to `true` when**:
  - Fast rollback is critical
  - Disk space is not a concern
  - Need to inspect old deployment artifacts
  - Compliance requires artifact retention

- **Set to `false` when**:
  - Disk space is limited
  - Artifacts can be rebuilt quickly
  - Storage costs are a concern
  - Security requires artifact removal

### Choosing autoCleanup

- **Set to `true` when**:
  - Want automated maintenance
  - Trust the retention policy
  - Don't need manual review before cleanup

- **Set to `false` when**:
  - Need to review before cleanup
  - Want to manually control cleanup timing
  - Have custom cleanup schedules
  - Compliance requires manual approval

## Monitoring and Troubleshooting

### Logs

Cleanup operations are logged at various levels:

**Info Level**:
```
Successfully cleaned up 3 old deployments for service my-service
```

**Warning Level**:
```
Failed to cleanup old deployments for service my-service: Docker image not found
```

**Debug Level**:
```
Keeping 5 most recent deployments, deleting 3 older deployments
```

### Common Issues

**Issue**: Cleanup not happening automatically
- **Check**: `autoCleanup` is set to `true`
- **Check**: Deployments are actually succeeding (only successful deployments trigger cleanup)
- **Check**: Service logs for cleanup errors

**Issue**: Too many deployments being kept
- **Check**: `maxSuccessfulDeployments` value in service configuration
- **Check**: Only successful deployments are counted (pending/failed don't count)

**Issue**: Disk space not being freed
- **Check**: `keepArtifacts` is set to `false`
- **Check**: Docker images are actually being removed (check with `docker images`)
- **Check**: Static file directories are being deleted

**Issue**: Cleanup failures blocking deployments
- **Solution**: Cleanup is designed to NOT block deployments
- **Verify**: Check that deployment still succeeded even if cleanup failed
- **Action**: Investigate cleanup failure logs, fix underlying issue

## Database Schema

The `services` table includes the `deployment_retention` column:

```sql
ALTER TABLE "services" 
ADD COLUMN "deployment_retention" jsonb 
DEFAULT '{"maxSuccessfulDeployments":5,"keepArtifacts":true,"autoCleanup":true}'::jsonb;
```

## Migration

### For Existing Services

When the migration runs:
1. All existing services receive default retention policy
2. No immediate cleanup occurs
3. Cleanup starts after next successful deployment

### Manual Migration Steps

If you need to customize existing services:

```typescript
// Update all services to keep 10 deployments
await db.update(services)
  .set({
    deploymentRetention: {
      maxSuccessfulDeployments: 10,
      keepArtifacts: true,
      autoCleanup: true
    }
  })
  .where(eq(services.organizationId, 'your-org-id'));
```

## Performance Considerations

- **Async Cleanup**: Runs in background, doesn't block deployment success
- **Batch Operations**: Deletes multiple old deployments in single transaction
- **Graceful Failures**: Individual cleanup failures don't stop overall process
- **Database Queries**: Uses indexed `createdAt` column for efficient sorting
- **Artifact Cleanup**: May take time for large Docker images/files

## Security Considerations

- **Artifact Retention**: Set `keepArtifacts: false` if artifacts contain sensitive data
- **Audit Trail**: Consider longer retention for services requiring audit trails
- **Compliance**: Adjust retention policy to meet compliance requirements
- **Manual Review**: Use `autoCleanup: false` if compliance requires manual approval

## Future Enhancements

Potential improvements to the retention system:

- **Scheduled Cleanup**: Cron jobs for services with `autoCleanup: false`
- **Retention by Time**: Keep deployments from last N days instead of count
- **Selective Artifact Retention**: Keep images but delete logs, or vice versa
- **Metrics Dashboard**: Track storage usage per service
- **Bulk Operations**: Update retention policy for multiple services
- **Notification System**: Alert when cleanup fails or storage threshold exceeded
- **Cost Tracking**: Calculate storage costs per service
- **Custom Policies**: Different policies for different environments (dev/staging/prod)

---

For related documentation, see:
- [Deployment Health Rules](./DEPLOYMENT-HEALTH-RULES.md)
- [Development Workflow](../../guides/DEVELOPMENT-WORKFLOW.md)
- [Production Deployment](../../guides/PRODUCTION-DEPLOYMENT.md)
