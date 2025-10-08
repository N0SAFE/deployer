# Project-level HTTP Server + Traefik Integration

This document describes the design and implementation plan to replace the current per-deployment nginx containers with a single lightweight HTTP server container per project. The goal is to centralize static-file serving per project, make deployments atomic and rollback-capable, retain a configurable number of previous deployments, and integrate with Traefik for request routing.

This document covers: goals, constraints, architecture, storage layout, server selection and configuration (lighttpd), Traefik integration and label conventions, deployment runtime flow, rollback and retention, migration strategy, operational runbook and commands, API/code changes required, tests, monitoring, security, and troubleshooting.

---

## Goals

- Run one HTTP server container per project ("project-http") to serve static files for all services within that project.
- Keep per-service multiple deployments on disk under the project volume and expose a stable location for the active deployment using an atomic symlink `current` so we can rollback safely.
- Keep N previous deployments (default N = 5) for rollback and auditability.
- Serve files via a minimal, memory-friendly HTTP server (lighttpd) that logs to stdout so container logs integrate with Docker and Traefik.
- Integrate Traefik at the project level using Docker provider labels on the `project-http` container.
- Eliminate per-deployment containers for static serving; keep the orchestration responsibilities inside the deployer (StaticFileService).
- Provide easy migration steps from the previous per-deployment model and automations for cleanup.

---

## High-level architecture

- For each project `P` create a single Docker volume named `project-<projectId>-static` and a single container named `project-http-<projectId>` that mounts that volume:
  - Volume: `project-3016ac43-static`
  - Container: `project-http-3016ac43`
  - Mount: `/srv/static`
- Static files are stored under the mounted volume in the following canonical layout:
  - `/srv/static/<serviceName>/<deploymentId>/...` — full file tree for a deployed version.
  - `/srv/static/<serviceName>/current` — symlink (or directory) pointing to the active `<deploymentId>` directory.
  - Optional `_meta/` area per service for deployment metadata, timestamps, and pruning markers.
- Traefik routes requests by `Host` header at the project-level to the `project-http` container. The project server inspects the incoming path and serves from the appropriate service's `current` directory.
- Default routing style (recommended): project-level host + path-based service prefixes. Example:
  - Request: `Host: project.example.com` `GET /s/static-demo/index.html` → `project-http` serves `/srv/static/static-demo/current/index.html`.
- Alternate routing (optional): per-service subdomains `static-demo.project.example.com`. This requires creating routers per service or using wildcard and internal routing logic; the path-based approach minimizes Traefik router sprawl.

---

## Why lighttpd?

- Lightweight: small memory footprint and small Docker images (alpine) ideal for single-purpose static servers.
- Performance: efficient static file serving with low overhead.
- Simple reload semantics: responds to HUP signals for gentle configuration reloads (useful for runtime reloads after retention/rollback operations if needed).
- Logging: easy to route access and error logs to stdout/stderr.

Alternatives considered:
- Nginx: powerful but heavier; still acceptable, but lighttpd provides simpler footprint.
- Caddy: more features (automatic TLS) but adds complexity; Traefik handles TLS.

Recommendation: use `lighttpd:alpine` unless project needs require nginx-specific features.

---

## Storage layout and atomic deployment semantics

Per-project volume layout
- Volume root mounted at `/srv/static` in the `project-http` container.
- For each service `svc`:
  - Deployment directories: `/srv/static/svc/<deploymentId>/...`
  - Active symlink: `/srv/static/svc/current -> ./<deploymentId>` (use `ln -sfn` to atomically update)
  - Metadata file per deployment: `/srv/static/svc/<deploymentId>/.deployer-meta.json` containing timestamp, user, deployment id, commit/manifest, and retention flags.

Atomic deployment flow (in detail)
1. Create a temporary directory under the deployer workspace: `/tmp/deployer-workspace/deployment-<deploymentId>` and populate it with static files.
2. Stream/copy files into the project volume under a temporary name (containerized `tar` or using Docker API copy): `/srv/static/svc/<deploymentId>.tmp`.
3. Validate files and optionally run a light-weight check (do not rely on application logic): ensure index.html exists or a valid index fallback.
4. Atomically rename the temp dir to the target name (inside project container): `mv /srv/static/svc/<deploymentId>.tmp /srv/static/svc/<deploymentId>` — this is atomic on the same filesystem.
5. Update the `current` symlink using `ln -sfn ./<deploymentId> /srv/static/svc/current` to flip the active served files atomically.
6. After symlink update, optionally write a metadata entry and prune older deployments.
7. If any step fails, revert to previous symlink and mark the deployment as failed.

Note: All file operations that modify mounted volume content must either run inside the `project-http` container by `exec`ing commands (preferred) or use Docker volume copy helpers that ensure file ownership and atomicity.

Retention and rollback
- Default retention: keep 5 latest deployment directories per service.
- Pruning strategy: after a successful new deployment and symlink swap, list directories sorted by timestamp or metadata and delete the oldest ones beyond retention count.
- Rollback: to rollback to a prior deployment, update `/srv/static/svc/current` symlink to point to the older `<deploymentId>` and optionally mark a new rollback deployment entry (or create a new deployment entry by copying previous files into a fresh `<deploymentId>` to keep timeline linear).
- Keep metadata `.deployer-meta.json` to track source and to reconstruct audit trails.

---

## Traefik integration and routing

Traefik placement
- Attach `project-http-<projectId>` container to the same Docker network Traefik uses (e.g., `deployer_app_network_dev`).
- Use Docker provider labels on the `project-http` container to register a single router per project.

Recommended label conventions
- `traefik.enable=true`
- `traefik.docker.network=deployer_app_network_dev`
- `traefik.http.routers.project-<projectId>.entrypoints=web`
- `traefik.http.routers.project-<projectId>.rule=Host(`<projectHost>` )`  (example: `Host(`project.example.com`)`)
- `traefik.http.services.project-<projectId>.loadbalancer.server.port=80`
- Optional: `traefik.http.middlewares.project-rate-limit.rateLimit.average=100` etc. for per-project QoS.

Routing patterns inside the server
- Path prefix approach: `/<prefix>/<serviceName>/...` where `<prefix>` default `s` (short for service), full path example: `/s/static-demo/`.
- The `project-http` server must perform a secure mapping from request path to filesystem path — sanitize service names to avoid path traversal.

Examples
- Host header: `Host: project.example.com` and request `GET /s/static-demo/` → serve `/srv/static/static-demo/current/index.html`.

Important notes
- Because Traefik now only sees project-level routers (not per-deployment), there will be no per-deployment routers to collide with. This significantly reduces stale file-provider YAML risk.
- If a project desires per-service subdomains, the deployer must create additional routers (or a wildcard router) per service — this is optional but supported.

---

## Project HTTP server container: implementation details

Container configuration
- Image: configurable via `PROJECT_SERVER_IMAGE` environment variable. Default used in the deployer is `rtsp/lighttpd`.
- This can be changed to an internal or custom image if you need a different lighttpd build.
- Name: `project-http-<projectId>`
- Volume: mount `project-<projectId>-static:/srv/static`
- Network: attach to `deployer_app_network_dev` (or configured default provider network)
- Labels: Traefik labels as above
- Healthcheck: `CMD-SHELL: wget -q -O - http://localhost:80/health || exit 1` or a small static file `/srv/static/_health/ok.txt` served on `/health`.
- Restart policy: `unless-stopped`
- Resource constraints (recommended): 128–256MB memory limit, small CPU share according to environment.

Lighttpd configuration template (core excerpts)
- Document root: `/srv/static`
- Index file handling: `index-file.names = ( "index.html", "index.htm" )`
- Alias & mod_rewrite: rewrite `/s/<service>(/.*)?` → `/srv/static/<service>/current$1`
- Access and error logs: `accesslog.filename = "/dev/stdout"` and `server.errorlog = "/dev/stderr"`
- Simple health endpoint: expose `/health` serving 200 OK from `/srv/static/_health/ok.txt`.

Example lighttpd config snippet (to be included in the `project-http` image or mounted):

```lighttpd
server.document-root = "/srv/static"
server.port = 80
server.indexfiles = ("index.html","index.htm")
accesslog.filename = "/dev/stdout"
server.errorlog = "/dev/stderr"

$HTTP["url"] =~ "^/s/([A-Za-z0-9_-]+)(/.*)?$" {
    # map /s/<service>/... to /srv/static/<service>/current/...
    url.rewrite-once = (
        "^/s/([A-Za-z0-9_-]+)(/.*)?$" => "/$1/current$2"
    )
}

$HTTP["url"] == "/health" {
    dir-listing.activate = "disable"
}
```

Security notes about rewriting:
- Use a strict regex for service names (alphanumeric, dash, underscore) to avoid path traversal.
- Do not allow `..` or slashes in service names.

---

## Deployer changes (code-level design)

Key new functions and services to add

1. `ProjectServerService` (new)
- Responsibilities:
  - Ensure a project volume exists `project-<projectId>-static`.
  - Ensure a `project-http-<projectId>` container is running and labeled for Traefik.
  - Provide APIs for reload (send HUP), status, and graceful restart.
- Key methods:
  - `ensureProjectServer(projectId, domain, options)` — idempotent create/ensure.
  - `reloadProjectServer(projectId)` — exec in container to reload lighttpd (or send SIGHUP).
  - `getProjectServerStatus(projectId)` — return container health, mounted volumes, and usage stats.

2. `StaticFileService` (modify)
- Updated responsibilities:
  - Instead of creating per-deployment containers, place files into the `project-<id>-static` volume following the layout described earlier.
  - Perform atomic symlink swap to set `current` and prune older deployments.
  - Call `ensureProjectServer()` before deploying to guarantee server existence.
  - On success, emit events & update deployment metadata.
- Key methods to change/add:
  - `deployStaticFiles(deploymentId, projectId, serviceName, files)` — new flow that writes to volume and flips symlink.
  - `pruneDeployments(projectId, serviceName, keep=5)` — enforce retention.
  - `rollbackDeployment(projectId, serviceName, targetDeploymentId)` — symlink flip + metadata entry.

3. `TraefikService` (modify)
- Responsibilities:
  - Stop writing per-deployment file-provider YAMLs for services that are backed by a `project-http` server.
  - Ensure project-level Docker labels are created/updated on the `project-http` container (done by `ProjectServerService.ensureProjectServer`).
  - Provide migration helpers to cleanup stale dynamic YAMLs referencing old per-deployment routers.

4. `MigrationScript` (new script)
- Responsibilities:
  - Discover existing per-deployment containers (label `deployer.managed=true`, `deployer.nginx.static=true`).
  - For each container, copy files into the appropriate project volume path and set `current` symlink to the most recent deployment.
  - Remove old per-deployment containers and remove stale Traefik dynamic files that referenced the removed containers.

API changes and events
- New APIs/endpoints (HTTP or internal) to:
  - `POST /orchestration/projects/:projectId/server/ensure` — ensure server exists (idempotent).
  - `POST /static-file/:service/deploy` — previously existed; modify semantics to deploy into project volume and return deploymentId and path.
  - `POST /static-file/:service/:deploymentId/rollback` — point `current` to an older deployment.
- Events produced:
  - `project.server.started`
  - `deployment.deployed`
  - `deployment.retain.pruned`
  - `deployment.rollback`

---

## Migration plan (manual steps)

### Quick dry-run (manual commands)
1. Create volume for project `3016ac43`:

```bash
docker volume create project-3016ac43-static
```

2. Start project http container:

```bash
docker run -d \
  --name project-http-3016ac43 \
  --network deployer_app_network_dev \
  -v project-3016ac43-static:/srv/static \
  --label traefik.enable=true \
  --label traefik.docker.network=deployer_app_network_dev \
  --label "traefik.http.routers.project-3016ac43.rule=Host(`project.localhost`)" \
  --label "traefik.http.services.project-3016ac43.loadbalancer.server.port=80" \
  lighttpd:alpine
```

3. Copy existing per-deployment files into the new volume. If old per-deployment had mounted volumes or files, use `docker cp` or `rsync`:

```bash
# Example: copy from old container old-static-xxx:/usr/share/nginx/html -> volume via a temp container
docker run --rm --volumes-from old-static-xxx -v project-3016ac43-static:/target alpine sh -c 'cp -a /usr/share/nginx/html /target/static-demo/49dbbfb0 && echo "{\"id\":\"49dbbfb0\",\"ts\":\"`date -Iseconds`\"}" > /target/static-demo/49dbbfb0/.deployer-meta.json'

# then set symlink for current inside a container (must run inside project-http container or another container mounting the volume):
docker exec project-http-3016ac43 sh -c 'mkdir -p /srv/static/static-demo && ln -sfn ./49dbbfb0 /srv/static/static-demo/current'
```

4. Remove old per-deployment container once verified:

```bash
docker rm -f old-static-xxx
```

5. Remove stale Traefik YAMLs (run inside Traefik container or host):

```bash
docker exec deployer-traefik-dev sh -c 'rm -f "/etc/traefik/dynamic/projects/My Blog/dynamic-*.yaml"'
# or remove only ones that reference static-demo
```

6. Validate by requesting via host header:

```bash
curl -H 'Host: project.localhost' http://localhost/s/static-demo/
```

### Automated migration implementation
- The `MigrationScript` should implement the steps above for all existing per-deployment containers and create metadata entries for retained history. The script must be idempotent and should fail safe (do not delete the per-deployment container until a verification step passes).

---

## Tests & validation

Unit tests
- Filesystem helpers: ensure `safeServiceName()` sanitizes service names; test renames and symlink behavior.
- Metadata writing & pruning logic.

Integration tests
- Boot a `project-http` in test harness (docker-compose with small lighttpd) and deploy a test `svc` with two deployments; assert:
  - Requests to `/s/<svc>/` return expected files and no partial files during swap.
  - After switch, old `current` content not served.
  - Pruning keeps N=5 items and deletes older ones.
- Traefik integration test (optional): run Traefik in the test harness, assert that the host header gets routed to the project container and status 200.

E2E tests
- Full deployment → prune → rollback path.

---

## Monitoring and operational concerns

- Health checks: `project-http` should expose `/health` returning 200. Traefik should map health checks to the container.
- Logging: lighttpd config must write access log to stdout and error log to stderr. Deployer must collect and surface container logs in UI.
- Metrics: track deployment counts, pruning actions, disk usage per project, and last successful deployment timestamp.
- Alerts: alert when free disk under volume drops below threshold or when a deployment fails to complete.

---

## Security and safety

- Sanitize `serviceName` and `deploymentId` strictly; using a regex `[A-Za-z0-9_-]+` to avoid path traversal.
- Do not accept arbitrary symlink targets from user input.
- Ensure file ownership and permissions when copying files into volume (run copy commands as root inside container then chown/chmod as appropriate).
- Limit volume access: only `project-http` and the orchestrator should mount the project volume.
- Validate uploaded files for large sizes and scan for executable bits — static servers should not execute code.

---

## Edge cases & troubleshooting

- Partial uploads: Use temporary directories to avoid serving partially uploaded content. Only flip `current` after a fully successful copy.
- Concurrency: When two deployments arrive simultaneously, a coordination lock is needed per `(project, service)` to serialize the atomic swap and pruning steps. Use a DB-backed lock or an in-memory distributed lock if multiple deployer instances exist.
- Disk exhaustion: If volume runs out of space during copy, revert to previous symlink and mark deployment failed. Provide a clear human-readable error with steps to free space.
- File permissions mismatch: Prefer `chown -R 1000:1000` or a pre-defined server UID inside container for consistent ownership.

### Known runtime crash (Bun) — diagnosis & mitigations

Observed symptom (example): during a static deployment the API process abruptly segfaults and Bun prints a crash report with a segmentation fault, e.g.:

```
Bun v1.2.21 ...
RSS: 2.22GB | Peak: 1.79GB | Commit: 2.22GB | Machine: 2.15GB
panic: Segmentation fault at address 0x...
oh no: Bun has crashed. This indicates a bug in Bun, not your code.
```

Root cause analysis (typical patterns):
- Bun segmentation faults in memory-exhaustion scenarios or when the process exceeds the host/container memory limits.
- In this template the upload → extract → analyze → copy flow can produce high transient memory usage when:
  - Uploads are received as an in-memory base64 buffer (client converts file to base64 and server reconstructs full Buffer).
  - The service performs file tree traversal and builds large arrays (e.g. manifest generation) in memory for very large or numerous files.
  - Multiple concurrent uploads/deployments run together and memory peaks combine.

Immediate mitigations:
1. Increase container memory for the API service (Docker Compose / host) so the process has headroom to avoid OOM-related crashes. For example in docker-compose add a memory reservation/limit for the api service while debugging.
2. Prefer Node.js runtime for long-running server processes in production: Bun is fast but has produced the crash above; switching the `apps/api` container to run `node` (Node 20+) is a pragmatic short-term fix.
3. Stream uploads to disk instead of keeping large buffers in memory:
   - Move from base64 payloads to multipart/form-data streaming at the transport layer, or
   - Write incoming binary frames directly to a temporary file and avoid holding a Buffer for the entire upload.
4. Avoid building large arrays in memory when analyzing extracted files. Use streaming or generator-based directory walking and manifest generation to keep memory bounded.
5. Limit concurrency for heavy operations (throttle number of simultaneous deployments/uploads per API process).

Recommended code-level changes to mitigate memory pressure (implemented or near-term):
- Change `FileUploadService.analyzeExtractedFiles()` to iterate files using an async generator so the service never builds an in-memory list of all file paths. Process each file sequentially and write manifest entries incrementally to disk.
- Avoid reading entire archives into memory (use streaming extractors which the code already does — ensure those paths avoid intermediate buffering).
- For large projects, produce manifests incrementally and stream them to a file rather than constructing a huge JSON object in memory.

Operational guidance:
- If you see Bun crashes in logs, immediately check container memory limits and process RSS values. If memory nears host/container limits, increase the memory and/or throttle concurrency.
- If you prefer a conservative, robust runtime, switch the API container to use Node.js until Bun's runtime in your environment proves stable under load.

Example: limiting concurrency in the deploy queue (high-level)
1. Configure Bull queue worker concurrency to a small value (e.g. 2–4) for heavy extract/deploy tasks.
2. Use a database-backed lock for `(projectId, serviceId)` to serialize simultaneous deploys for a given service.

Note: these mitigations reduce peak memory and make the service resistant to Bun-native crashes that are triggered by OOM or extreme memory fragmentation.

---

## Implementation checklist & timeline (estimate)

1. Create `ProjectServerService` (2 days)
2. Implement lighttpd config template and project image or startup command (0.5 day)
3. Modify `StaticFileService` to deploy into project volume and implement atomic symlink swap + pruning (2 days)
4. Implement migration script and manual runbook (1 day)
5. Add integration tests and CI harness (2 days)
6. Add monitoring, health-checks, and alerts (1 day)

Total: ~8.5 working days (can be parallelized) depending on test harness availability.

---

## Appendix: example commands and minimal helper scripts

- Create project volume and start server

```bash
PROJ=3016ac43
VOL=project-${PROJ}-static
CNAME=project-http-${PROJ}
HOST=project.localhost

docker volume create "${VOL}"

docker run -d \
  --name "${CNAME}" \
  --network deployer_app_network_dev \
  -v "${VOL}:/srv/static" \
  --label traefik.enable=true \
  --label traefik.docker.network=deployer_app_network_dev \
  --label "traefik.http.routers.${CNAME}.rule=Host(`${HOST}`)" \
  --label "traefik.http.services.${CNAME}.loadbalancer.server.port=80" \
  lighttpd:alpine
```

- Deploy files into project volume and flip symlink (run inside `project-http-<id>` or another container that mounts the volume):

```bash
# assume files in /tmp/deploy-<id>/
SERVICE=static-demo
DEPLOY_ID=49dbbfb0
VPATH=/srv/static/${SERVICE}
TMPDIR=${VPATH}/${DEPLOY_ID}.tmp
DIR=${VPATH}/${DEPLOY_ID}

mkdir -p ${TMPDIR}
# copy files from host to volume mount (example using a temporary container that shares the volume)
docker run --rm -v project-3016ac43-static:/target -v /tmp/deploy-49dbbfb0:/src alpine sh -c 'cp -a /src/* /target/static-demo/49dbbfb0.tmp'

# inside a container with volume mounted:
mv ${TMPDIR} ${DIR}
ln -sfn ./${DEPLOY_ID} ${VPATH}/current
# write metadata
cat > ${DIR}/.deployer-meta.json <<EOF
{"id":"${DEPLOY_ID}","ts":"$(date -Iseconds)","source":"upload"}
EOF

# prune older deployments (keep 5)
ls -1dt ${VPATH}/*/ | sed -n '6,$p' | xargs -r rm -rf
```

---

If you want, I will:
- Implement `ProjectServerService` and `StaticFileService` changes in the repo now, including a lighttpd config file template and tests.
- Or create a standalone migration script and a one-shot playbook to move current per-deployment containers into the new per-project layout.

Tell me which you prefer and I will proceed.
