# Q&A — Platform Direction: Build & CI/CD Pipeline

> **Module**: platform-direction  
> **Category**: build-cicd  
> **Last updated**: 2026-03-04

---

## GitHub integration features

**Q**: Which GitHub integration features must be supported at launch?

**A**: All of the following:
- Auto-deploy on push to a branch (branch → environment mapping)
- PR preview environments (auto-create on PR open, auto-destroy on PR close)
- Commit status checks (report deploy result back to GitHub)
- Monorepo support (detect which service changed by path filter — only redeploy affected service)

GitLab is a provider target but deferred to post-launch.

---

## CI/CD pipeline stages

**Q**: What stages should a deployment pipeline have?

**A**: All of the following, **configurable per service** (each phase can be enabled/disabled):
1. **Build** — Dockerfile / Nixpacks
2. **Test** — run a command in the built image before promoting
3. **Release** — tag image, push to registry
4. **Deploy** — pull image, restart container
5. **Post-deploy smoke test** — hit health endpoint after deploy
6. **Manual approval gate** — optional human approval step before deploy

Each service configures which phases are active. A simple static site might only need Build + Deploy. A critical API would use all 6.

---

## Build pipeline customization

**Q**: How configurable should the build pipeline be?

**A**: Full flexibility:
- Auto-detect runtime via Nixpacks (zero-config)
- Dockerfile at repo root
- Custom Dockerfile path (monorepo support)
- Build args and build-time secrets (injected at build time only, never baked into the image)
- Pre-build and post-build hook scripts (arbitrary shell commands)

---

## Docker Compose service management

**Q**: For Docker Compose projects: does the user provide the compose file, or does the platform generate it?

**A**: Both:
- Upload / link an existing `docker-compose.yml` from the repo → platform manages it as a single deploy unit
- Configure services via the GUI → platform generates and manages the compose file

---

## Provider system

**Q**: What external systems should the provider abstraction cover?

**A**: All of the following (provider abstraction handles credential storage, auth, API calls):
- GitHub (source + webhooks)
- GitLab (source + webhooks)
- Docker Registry (GHCR, Docker Hub, private registries)
- DNS providers (Cloudflare, etc.)
- Storage providers (S3, Backblaze, etc.)
- Notification providers (Slack, email, Discord)

Third-party providers can also be added via the plugin API.

---

## Registry management

**Q**: Does the platform run its own Docker registry, or rely purely on external registries?

**A**: Both:
- **Built-in private registry** hosted on the cluster — used for images built on the platform (all nodes pull from it)
- **External registry support** — for pre-built images (GHCR, Docker Hub, private) using stored provider credentials
