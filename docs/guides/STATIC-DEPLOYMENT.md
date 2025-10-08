# Static File Deployment Guide

## Overview

This guide covers deploying static websites (HTML, CSS, JavaScript) using the platform's built-in static file serving capability. Static deployments are served via lighttpd web server and routed through Traefik.

**Use Cases:**
- Static HTML websites
- Single-page applications (SPA) built with React, Vue, Angular
- Documentation sites (mkdocs, Jekyll, Hugo)
- Landing pages
- Static demos and prototypes

## Architecture

### Components

```
┌─────────────────┐
│   Traefik       │ ← Routes requests based on Host header
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  project-http   │ ← lighttpd container (rtsp/lighttpd image)
│  Container      │
└────────┬────────┘
         │
         ├── /var/www/html/        ← Webroot (symlinks to deployed files)
         │   ├── index.html → /srv/static/service/current/index.html
         │   ├── style.css → /srv/static/service/current/style.css
         │   └── ...
         │
         └── /srv/static/          ← Volume with deployment directories
             └── <service-name>/
                 ├── current → <deployment-id>  (symlink)
                 ├── <deployment-id-1>/
                 ├── <deployment-id-2>/
                 └── <deployment-id-3>/
```

### Key Design Decisions

1. **Symlink-Based Deployment**: Uses symlinks from `/var/www/html/` to `/srv/static/<service>/current/*` because lighttpd's `server.document-root` cannot be overridden in conditional blocks.

2. **Volume Persistence**: Deployment files stored in Docker volume at `/srv/static/<service>/<deployment-id>/` for persistence and rollback capability.

3. **Atomic Switches**: The `current` symlink is updated atomically (`ln -sfn`) to ensure zero-downtime deployments.

4. **Validation at Every Step**: File copy, symlink creation, permissions, and HTTP accessibility are all validated.

## Features

### Core Capabilities

| Feature | Description |
|---------|-------------|
| **File Extraction** | Extracts files from embedded content or source path |
| **Container→Volume Copy** | Archives and copies files to Docker volume with validation |
| **File Copy Validation** | Validates files were actually copied (fail-fast) |
| **Symlink Management** | Manages `current` symlink atomically for zero-downtime |
| **Webroot Symlinks** | Creates symlinks in `/var/www/html` for lighttpd serving |
| **Permission Setup** | Sets 644/755 permissions, UID 100:101 ownership |
| **Permission Verification** | Verifies lighttpd user can read files |
| **Server Reload** | Reloads lighttpd to pick up changes |
| **HTTP Verification** | Tests deployment is accessible via HTTP |
| **Multi-Service Detection** | Warns about multi-service conflicts |
| **Deployment Pruning** | Keeps last 5 deployments per service |
| **Error Handling** | Fail-fast on critical errors, warn on non-critical |

### Validation & Verification

| Check | When | Action on Failure |
|-------|------|-------------------|
| File Copy Validation | After copy | **Throw → Fail deployment** |
| Symlink Verification | After creation | **Throw → Fail deployment** |
| Webroot Setup | After symlinks | **Throw → Fail deployment** |
| Permission Check | After setup | **Warn → Continue** |
| HTTP Verification | End of deployment | **Warn → Continue** |

## Deployment Process

### Step-by-Step Flow

```
1. Extract Files
   └─> Files extracted from embedded content or source path

2. Copy to Volume
   ├─> Create directory: /srv/static/<service>/<deployment-id>/
   ├─> Copy files with tar archive
   ├─> Set permissions: 644 (files), 755 (directories)
   ├─> Set ownership: UID 100:101 (lighttpd user)
   └─> ✅ VALIDATE: Files exist in volume (CRITICAL)

3. Set Current Symlink
   ├─> Create/update: /srv/static/<service>/current → <deployment-id>
   └─> Atomic operation (ln -sfn)

4. Setup Webroot (CRITICAL STEP)
   ├─> Detect multi-service conflicts
   ├─> Clear /var/www/html/*
   ├─> Create symlinks: /var/www/html/* → /srv/static/<service>/current/*
   ├─> ✅ VALIDATE: Symlinks created
   ├─> ✅ VALIDATE: Lighttpd user can read files
   ├─> Reload lighttpd server
   └─> ❌ THROWS on any failure

5. Verify Deployment
   ├─> Test: curl -H 'Host: <domain>' http://127.0.0.1/
   ├─> Check: HTTP 200 response
   ├─> Fallback: Verify HTML files exist
   └─> ⚠️ Warn if verification fails

6. Prune Old Deployments
   └─> Keep last 5, remove older deployment directories

7. Return Success
   ├─> Deployment marked as 'success'
   └─> Files accessible via Traefik
```

### Deployment API Example

```bash
curl -X POST http://localhost:3001/api/deployments \
  -H 'Content-Type: application/json' \
  -d '{
    "projectId": "proj123",
    "serviceId": "svc456",
    "type": "static",
    "files": {
      "index.html": "<html>...</html>",
      "style.css": "body { ... }",
      "script.js": "console.log('Hello');"
    }
  }'
```

## Configuration

### Environment Variables

```bash
# Project HTTP server settings
PROJECT_HTTP_IMAGE=rtsp/lighttpd:latest
PROJECT_HTTP_NETWORK=deployer_network

# Static deployment settings
STATIC_DEPLOYMENTS_TO_KEEP=5  # Number of old deployments to retain
```

### Service Configuration

```typescript
{
  "name": "my-static-site",
  "type": "static",
  "domain": "my-site.example.com",
  "buildConfig": {
    "staticFiles": {
      "sourcePath": "./dist",  // or embedded content
      "indexFile": "index.html"
    }
  }
}
```

## Troubleshooting

### Common Issues

#### 1. 403 Forbidden Error

**Symptom:** Site returns 403 Forbidden when accessed.

**Causes:**
- lighttpd user cannot read files
- Incorrect permissions on files/directories
- Missing index.html file

**Solutions:**
```bash
# Check file permissions in container
docker exec project-http-<id> ls -la /var/www/html/

# Verify lighttpd user can read files
docker exec project-http-<id> su lighttpd -s /bin/sh -c "ls /var/www/html/"

# Check for index.html
docker exec project-http-<id> ls -la /var/www/html/index.html

# Redeploy to fix permissions
curl -X POST http://localhost:3001/api/deployments/<id>/redeploy
```

**Related:** See archived documentation for detailed fix:
- [`../archive/STATIC-FILE-DEPLOYMENT-FIX.md`](../archive/STATIC-FILE-DEPLOYMENT-FIX.md) - Lighttpd document-root limitation and symlink solution

#### 2. Deployment Status Stuck in "Pending"

**Symptom:** Static deployment shows as "pending" even though files are accessible.

**Causes:**
- Health monitor incorrectly checking static deployments for Docker containers
- Static deployments don't have containers, so health check returns "unknown"
- System maps "unknown" → "pending" status

**Solutions:**
This was a bug that has been fixed. Static deployments are now excluded from container health monitoring.

**Related:** See archived documentation for detailed fix:
- [`../archive/STATIC-DEPLOYMENT-STATUS-BUG-FIX.md`](../archive/STATIC-DEPLOYMENT-STATUS-BUG-FIX.md) - Health monitor exclusion fix

#### 3. Multiple Services Conflict

**Symptom:** Deploying a second static service breaks the first one.

**Cause:**
- Only ONE static service per project server is supported
- All services share `/var/www/html/` webroot
- Second deployment replaces first service's symlinks

**Warning Message:**
```
⚠️ Multiple services detected in project <id>
⚠️ Existing content in /var/www/html will be replaced with <service>
⚠️ This will break other services!
```

**Workarounds:**
1. **Separate Projects**: Use one project per static service
2. **Path-Based Routing**: Modify architecture to support `/service-name/` paths
3. **Multiple Containers**: Deploy one `project-http` container per service

#### 4. Files Not Found After Deployment

**Symptom:** Deployment succeeds but files return 404.

**Diagnostic Steps:**
```bash
# 1. Check files in volume
docker exec project-http-<id> ls -la /srv/static/<service>/current/

# 2. Check symlinks in webroot
docker exec project-http-<id> ls -la /var/www/html/

# 3. Verify current symlink
docker exec project-http-<id> readlink /srv/static/<service>/current

# 4. Test HTTP from inside container
docker exec project-http-<id> sh -c "curl -H 'Host: <domain>' http://127.0.0.1/"

# 5. Check lighttpd logs
docker logs project-http-<id>
```

#### 5. Deployment Verification Failed

**Symptom:** Warning in logs: "Deployment verification failed"

**Meaning:** HTTP accessibility check failed, but deployment continued.

**Check:**
```bash
# Test from inside container
docker exec project-http-<id> sh -c "curl -v -H 'Host: <domain>' http://127.0.0.1/"

# Test via Traefik
curl -v http://<domain>/

# Check if HTML files exist
docker exec project-http-<id> ls -la /var/www/html/ | grep -E "html|htm"
```

**Note:** This is a warning, not an error. Deployment may still work if files are accessible via Traefik.

### Diagnostic Commands

```bash
# Check deployment logs
docker logs deployer-api-dev 2>&1 | grep -E "✅|⚠️|❌"

# List all deployments for a service
docker exec project-http-<id> ls -lt /srv/static/<service>/

# Check which deployment is current
docker exec project-http-<id> readlink /srv/static/<service>/current

# Verify webroot contents
docker exec project-http-<id> ls -la /var/www/html/

# Test HTTP response
curl -v http://<domain>/
```

### Log Indicators

**Success Indicators:**
```
✅ File copy validated: files exist in volume
✅ Created symlinks from /var/www/html to /srv/static/<service>/current
✅ Permission check passed: lighttpd user can access files
✅ Deployment verified: <domain> is accessible
```

**Warning Indicators:**
```
⚠️ Multiple services detected in project <id>
⚠️ Existing content will be replaced. This will break other services!
⚠️ Permission check failed: lighttpd user cannot read files
⚠️ Deployment verification failed: <reason>
```

**Error Indicators:**
```
❌ CRITICAL: Failed to ensure vhost for <service>
❌ File copy validation failed: directory is empty or does not exist
❌ Failed to configure web server: <error>
```

## Rollback Procedures

### Automatic Rollback

The system keeps the last 5 deployments per service. The `current` symlink always points to the active deployment.

### Manual Rollback

If you need to rollback to a previous deployment:

```bash
# 1. List available deployments (newest first)
docker exec project-http-<id> ls -lt /srv/static/<service>/

# Example output:
# drwxr-xr-x  2 lighttpd lighttpd 4096 Jan 15 10:30 dep-abc123  ← current
# drwxr-xr-x  2 lighttpd lighttpd 4096 Jan 15 09:15 dep-def456  ← previous
# drwxr-xr-x  2 lighttpd lighttpd 4096 Jan 14 14:20 dep-ghi789

# 2. Choose previous deployment ID
PREV_ID="dep-def456"

# 3. Switch current symlink and update webroot
docker exec project-http-<id> sh -c "
  ln -sfn ./$PREV_ID /srv/static/<service>/current &&
  rm -rf /var/www/html/* &&
  ln -sf /srv/static/<service>/current/* /var/www/html/
"

# 4. Reload lighttpd
docker exec project-http-<id> killall -HUP lighttpd

# 5. Verify rollback
curl http://<domain>/
```

### Rollback via API

```bash
# Rollback to specific deployment
curl -X POST http://localhost:3001/api/deployments/<deployment-id>/rollback

# System will:
# 1. Set specified deployment as current
# 2. Update webroot symlinks
# 3. Reload lighttpd
# 4. Verify HTTP accessibility
```

## Best Practices

### 1. Build Process

**Pre-build your static files** before deployment:

```bash
# React/Vue/Angular
npm run build          # Output: dist/ or build/

# Jekyll/Hugo
bundle exec jekyll build   # Output: _site/
hugo                       # Output: public/

# Deploy the build output
curl -X POST .../deployments -d @- <<EOF
{
  "sourcePath": "./dist",
  "type": "static"
}
EOF
```

### 2. File Organization

**Include all necessary files:**
- `index.html` (required - entry point)
- CSS, JavaScript, images
- Fonts, assets
- Error pages (404.html, 500.html)

**Directory structure example:**
```
dist/
├── index.html
├── assets/
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   └── app.js
│   └── images/
│       └── logo.png
└── 404.html
```

### 3. Performance Optimization

**Optimize before deployment:**
- Minify CSS and JavaScript
- Compress images
- Enable gzip compression (lighttpd default)
- Use CDN for large assets

### 4. Testing

**Test locally before deployment:**
```bash
# Test with local web server
python3 -m http.server 8000
# or
npx http-server dist/

# Open http://localhost:8000
```

### 5. Monitoring

**Monitor deployment success:**
```bash
# Watch deployment logs
docker logs -f deployer-api-dev | grep -E "static|✅|⚠️|❌"

# Check deployment status
curl http://localhost:3001/api/deployments/<id>

# Verify HTTP accessibility
curl -I http://<domain>/
```

## Limitations

### 1. Single Service Per Project Server ⚠️

**Critical Limitation:** Only ONE static service per project server is supported.

**Why?**
- All services share the same `/var/www/html/` webroot
- lighttpd's `server.document-root` cannot be overridden in conditional blocks
- Second service deployment will replace first service's files

**Workarounds:**
1. **Use Separate Projects**: Create one project per static service
2. **Modify Architecture**: Implement path-based routing (`/service-name/`)
3. **Multiple Containers**: Deploy one `project-http` container per service

**Detection:** System logs warning when multiple services detected:
```
⚠️ Multiple services detected in project <id>
⚠️ This will break other services!
```

### 2. No Container Health Checks

**Limitation:** Static deployments don't use Docker containers, so container-based health monitoring doesn't apply.

**Impact:** Health status is based on deployment success/failure, not runtime health.

**Solution:** HTTP verification checks accessibility after deployment.

### 3. Traefik Label Updates

**Limitation:** Traefik labels are only set when the `project-http` container is created, not updated dynamically.

**Impact:** Only the first service gets proper Traefik routing configuration.

**Workaround:** Recreate container when adding new services (destroys existing deployments).

### 4. Build Process Not Included

**Limitation:** System doesn't build static sites from source (no npm install, Jekyll build, etc.).

**Expectation:** Deploy pre-built static files only.

**Solution:** Build locally or in CI/CD pipeline before deployment.

## Production Readiness

### ✅ Production-Ready Features

- ✅ File copy validation
- ✅ Symlink verification
- ✅ Permission checks
- ✅ HTTP accessibility verification
- ✅ Multi-service detection
- ✅ Proper error handling
- ✅ Clear log messages
- ✅ Fail-fast on critical errors
- ✅ Rollback procedures
- ✅ Deployment pruning (keeps last 5)

### ⚠️ Limitations to Consider

- ⚠️ Single service per project server
- ⚠️ No automated rollback on failure
- ⚠️ No build process integration
- ⚠️ No runtime health monitoring
- ⚠️ Static Traefik label configuration

### 🔄 Recommended Improvements

1. **Multi-Service Support**: Implement path-based routing or separate containers
2. **Automated Rollback**: Rollback on deployment verification failure
3. **Build Integration**: Support building from source (npm, Jekyll, Hugo)
4. **Health Monitoring**: Periodic HTTP health checks for static sites
5. **Dynamic Traefik Labels**: Update labels without container recreation

## Related Documentation

### Active Documentation
- [Deployment Health Rules](../features/deployment/DEPLOYMENT-HEALTH-RULES.md) - Service health calculation
- [Deployment Status Semantics](../features/deployment/DEPLOYMENT-STATUS-SEMANTICS.md) - Status definitions
- [Docker Build Strategies](../features/docker/DOCKER-BUILD-STRATEGIES.md) - Container deployment strategies
- [Development Workflow](./DEVELOPMENT-WORKFLOW.md) - General development workflow

### Archived Documentation (Bug Fixes)
- [Static File Deployment Fix](../archive/STATIC-FILE-DEPLOYMENT-FIX.md) - Lighttpd document-root limitation fix
- [Static Deployment Status Bug Fix](../archive/STATIC-DEPLOYMENT-STATUS-BUG-FIX.md) - Health monitor status bug
- [Bulletproof Static Deployment](../archive/BULLETPROOF-STATIC-DEPLOYMENT.md) - Implementation summary

## Summary

The static file deployment system provides **reliable, validated deployment** of static websites through lighttpd and Traefik routing.

**Key Strengths:**
- ✅ Validation at every step
- ✅ Fail-fast error handling
- ✅ Clear logging and diagnostics
- ✅ Rollback capability
- ✅ Zero-downtime deployments

**Key Limitations:**
- ⚠️ Single service per project server
- ⚠️ No build process integration
- ⚠️ Static configuration

**Deploy with confidence for single-service static sites!** 🚀
