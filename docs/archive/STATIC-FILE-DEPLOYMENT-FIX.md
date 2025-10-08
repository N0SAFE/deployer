# Static File Deployment Fix

## Problem Summary

Static file deployments were failing with 403 Forbidden errors when accessed through Traefik and the lighttpd web server.

## Root Cause

The `rtsp/lighttpd` Docker image has a pre-configured `server.document-root` setting in `/etc/lighttpd/conf.d/05-webroot.conf` that points to `/var/www/html`. Lighttpd does not allow overriding `server.document-root` within conditional `$HTTP["host"]` blocks, which meant our vhost configurations were being ignored.

### Technical Details

1. **File Copy Success**: Files were successfully extracted and copied to Docker volumes at `/srv/static/<service>/<deploymentId>/`
2. **Symlink Creation**: The `current` symlink was correctly created pointing to the deployment directory
3. **Configuration Limitation**: Attempted to override `server.document-root` in conditional blocks, which lighttpd silently ignores
4. **Default Webroot**: lighttpd always served from `/var/www/html` regardless of vhost config

## Solution

Instead of trying to override the document root in conditional blocks, we now:

1. **Leverage symlinks**: Create symlinks from `/var/www/html/*` pointing to `/srv/static/<service>/current/*`
2. **Use default webroot**: Let lighttpd serve from its default `/var/www/html` path
3. **Follow symlinks**: The `server.follow-symlink = "enable"` setting in the default config allows lighttpd to follow our symlinks
4. **Validate everything**: Add comprehensive validation at each step to ensure deployment actually works
5. **Fail fast**: Critical failures now cause deployment to fail immediately rather than silently continuing

### Implementation

Modified `ProjectServerService.ensureVhostForService()` to:

```typescript
async ensureVhostForService(projectId: string, host: string, serviceName: string) {
  const containerName = `project-http-${projectId}`;
  
  // Check for multi-service scenario
  const serviceCount = await checkExistingServices();
  if (serviceCount > 1) {
    logger.warn('Multiple services detected - may cause conflicts');
  }
  
  // Create symlinks from default webroot to our service's current directory
  const symlinkCmd = [
    'sh', '-c',
    `rm -rf /var/www/html/* && ln -sf /srv/static/${serviceName}/current/* /var/www/html/ && chmod 755 /var/www/html`
  ];
  
  await dockerService.execInContainer(containerName, symlinkCmd);
  
  // Verify symlinks and permissions
  await verifySymlinksCreated();
  await verifyLighttpdUserCanRead();
  
  await reloadProjectServer(projectId);
}
```

And `StaticFileService.deployStaticFiles()` to:

```typescript
async deployStaticFiles(options) {
  // 1. Copy files to volume
  await copyFromContainerToVolume(...);
  
  // 2. VALIDATE files were copied
  const validateResult = await runCommandInVolume(volumeName, validateScript);
  if (validateResult.exitCode !== 0) {
    throw new Error('File copy validation failed');
  }
  
  // 3. Set current symlink
  await setProjectServiceCurrent(...);
  
  // 4. Setup webroot symlinks (CRITICAL - throws on failure)
  try {
    await ensureVhostForService(...);
  } catch (vhostErr) {
    logger.error('CRITICAL: Failed to ensure vhost');
    throw new Error(`Failed to configure web server: ${vhostErr.message}`);
  }
  
  // 5. Verify deployment is accessible
  await verifyDeploymentAccessible(containerName, host);
  
  // 6. Prune old deployments
  await pruneOldDeployments(...);
  
  return success;
}
```

## Deployment Flow

### Before Fix

1. ✅ Extract files to `/tmp/deployer-workspace/deployment-<id>/`
2. ✅ Copy files to volume at `/srv/static/<service>/<deploymentId>/`
3. ✅ Create symlink `/srv/static/<service>/current` → `<deploymentId>`
4. ❌ Write vhost config trying to override `server.document-root`
5. ❌ lighttpd ignores the override, serves from `/var/www/html`
6. ❌ 403 Forbidden because `/var/www/html` is empty

### After Fix

1. ✅ Extract files to `/tmp/deployer-workspace/deployment-<id>/`
2. ✅ Copy files to volume at `/srv/static/<service>/<deploymentId>/`
3. ✅ **VALIDATE** files were copied successfully (new)
4. ✅ Create symlink `/srv/static/<service>/current` → `<deploymentId>`
5. ✅ Create symlinks from `/var/www/html/*` → `/srv/static/<service>/current/*`
6. ✅ **VERIFY** symlinks created and lighttpd user has read access (new)
7. ✅ Reload lighttpd
8. ✅ **VERIFY** deployment is accessible via HTTP (new)
9. ✅ Prune old deployments
10. ✅ lighttpd serves files from `/var/www/html` which now points to our files
11. ✅ 200 OK - Static site accessible

## Testing

### Automated Verification

The deployment process now includes automated verification:

1. **File Copy Validation**: Verifies files were copied to volume
2. **Symlink Verification**: Confirms symlinks were created in `/var/www/html`
3. **Permission Check**: Ensures lighttpd user can read files
4. **HTTP Verification**: Tests that the service is accessible via HTTP

Check the API logs for verification results:
```bash
docker logs deployer-api-dev 2>&1 | grep -E "✅|validation|verification"
```

### Manual Testing

Test static file deployment:

```bash
# 1. Deploy a static site via API
curl -X POST http://localhost:3001/api/deployments/... 

# 2. Verify files in volume
docker exec project-http-<project-id> ls -la /srv/static/<service>/current/

# 3. Verify symlinks in webroot
docker exec project-http-<project-id> ls -la /var/www/html/

# 4. Test lighttpd user can read files
docker exec project-http-<project-id> su lighttpd -s /bin/sh -c "ls /var/www/html/"

# 5. Test HTTP access from inside container
docker exec project-http-<project-id> sh -c "curl -H 'Host: <domain>' http://127.0.0.1/"

# 6. Test HTTP access via Traefik
curl http://<subdomain>-<service>.<domain>/
```

Expected results:
- Step 2: Files visible in `/srv/static/<service>/current/`
- Step 3: Symlinks point to service files
- Step 4: lighttpd user can list files (no permission denied)
- Step 5: Returns HTML content (200 OK)
- Step 6: Returns HTML content (200 OK)

### Troubleshooting Failed Deployments

If deployment fails, check the logs:

```bash
# API logs
docker logs deployer-api-dev -f | grep -E "ERROR|CRITICAL|Failed"

# Project server logs  
docker logs project-http-<project-id>

# Check deployment status in database
docker exec deployer-api-dev sh -c "psql \$DATABASE_URL -c \"SELECT id, status, error FROM deployments WHERE service_id='<service-id>' ORDER BY created_at DESC LIMIT 5;\""
```

Common failure points:
1. **File copy validation failed**: Files weren't copied to volume
2. **Failed to ensure vhost**: Symlink creation failed
3. **Permission denied**: lighttpd user can't read files
4. **HTTP verification failed**: Service not accessible

## File Permissions

The lighttpd user (UID 100) needs read access to files:
- Files: 644 (`rw-r--r--`)
- Directories: 755 (`rwxr-xr-x`)
- Ownership: UID 100:101 (lighttpd:lighttpd) or fallback to 1000:1000

These permissions are automatically set during the copy operations and verified before deployment completes.

## Related Files

- `/apps/api/src/core/services/project-server.service.ts` - Project HTTP server management
- `/apps/api/src/core/services/static-file.service.ts` - Static file deployment orchestration
- `/apps/api/src/core/services/docker.service.ts` - Docker operations wrapper

## Future Improvements

1. **Multi-service Support**: Currently, each project server can only serve one service's files at `/var/www/html`. For multiple services per project, we would need:
   - Virtual host configuration using `mod_evhost` or similar
   - Or separate project servers per service
   - Or path-based routing (`/service1/`, `/service2/`, etc.)

2. **Health Checks**: Add automated health checks after deployment to verify files are accessible

3. **Rollback Support**: Implement automatic rollback if deployment verification fails

## Known Limitations

### Multi-Service Deployments

**CRITICAL**: The current implementation supports **ONE static service per project server**. 

**Why?** The symlink approach uses `/var/www/html` as the webroot, which can only point to one service at a time. When a second service deploys to the same project:

1. ⚠️ The new service's symlinks **replace** the old service's symlinks in `/var/www/html`
2. ⚠️ The old service becomes **inaccessible** (404 or 403 errors)
3. ⚠️ Traefik routing may still point to the old service's domain

**Detection**: The code now detects multi-service scenarios and logs warnings:
```
Multiple services detected in project ${projectId}. Current limitation: Only one static service per project server is supported when using direct webroot symlinks.
Existing content in /var/www/html will be replaced with ${serviceName}. This will break other services!
```

**Workarounds**:
1. **Use separate projects**: Deploy each static service to its own project
2. **Use path-based routing**: Modify the architecture to use `/srv/static/<service>/` paths
3. **Use separate containers**: One project-http container per service (requires architecture change)

### Traefik Label Updates

When multiple services try to use the same project server, Traefik labels are **NOT updated** after the container is created. The `ensureProjectServer` method returns early if the container exists, without updating labels.

**Impact**: Only the FIRST service's domain will be properly routed by Traefik.

**Solution Required**: Either:
1. Update Traefik labels when new services are added
2. Use one project server per service
3. Use Traefik's file provider for dynamic configuration

## Migration Notes

Existing deployments using the old vhost configuration approach will need to be redeployed or manually fixed by running:

```bash
docker exec project-http-<project-id> sh -c "rm -rf /var/www/html/* && ln -sf /srv/static/<service>/current/* /var/www/html/"
docker exec project-http-<project-id> sh -c "kill -HUP 1"
```

## Conclusion

This fix ensures static file deployments work reliably with the `rtsp/lighttpd` Docker image by working **with** its default configuration rather than trying to override it. The symlink-based approach is simpler, more maintainable, and aligns with how the lighttpd image is designed to be used.
