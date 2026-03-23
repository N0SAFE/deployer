# Q&A — Platform Direction: Deployment Sources

> **Module**: platform-direction  
> **Category**: deployment-sources  
> **Last updated**: 2026-03-04

---

## Supported deployment sources (v3 launch)

**Q**: What is the primary deployment source for v3 launch?

**A**: GitHub (webhook + CI/CD), Zip / archive upload, Pre-built Docker image push.  
GitLab and direct Git URL are deferred (not v3 launch requirements).

---

## Service runtime types

**Q**: What runtime types must the platform support?

**A**: Docker container (built from Dockerfile) is the primary runtime. Additionally: Docker Compose management (multi-container services managed as a unit).

---

## Image building

**Q**: Does the platform build Docker images, or does the user push pre-built images?

**A**: Both — user chooses per service. Some services are built on the node (Dockerfile or Nixpacks), others are pulled from a registry as pre-built images.
