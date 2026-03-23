# Q&A — Platform Direction: UX, Dashboard & CLI

> **Module**: platform-direction  
> **Category**: ux-dashboard-cli  
> **Last updated**: 2026-03-04

---

## Dashboard views

**Q**: What is the landing page of the dashboard?

**A**: Both as separate views:
- **Org context view** — services, recent deploys, health status per service (default for regular users)
- **Platform admin view** — node health, resource usage across cluster, all orgs (toggled via admin mode)
- Context switch between orgs and admin mode in the header

---

## Deployment log experience

**Q**: What should the deployment log experience include?

**A**: All of the following:
- Build phase logs (Dockerfile output, Nixpacks output)
- Test phase output (stdout/stderr of the test command)
- Deploy phase logs (docker pull, container start events)
- Runtime logs (container stdout/stderr after start)
- Searchable / filterable log archive
- Download logs as a file (export)

Delivered via ORPC EventIterator (SSE bidirectional streaming) — same typed contract for all log types.

---

## In-browser terminal

**Q**: Should the dashboard include a web terminal to exec into containers?

**A**: Yes — xterm.js terminal in the dashboard to exec into a running container. Also available via CLI.

---

## Platform CLI

**Q**: What operations should the CLI support?

**A**: All of the following:
- Deploy / redeploy from terminal (`bun deploy` / `npx deployer deploy`)
- Tail live logs from terminal
- Exec into a running container
- Manage env vars from terminal
- Bootstrap / setup a new VPS node

---

## Notification channels

**Q**: What notification channels should be supported?

**A**: All of the following:
- In-app notifications (bell icon + notification feed)
- Email
- Web push (browser push notifications)
- GitHub / GitLab commit status reporting
- **Custom webhooks with transformed data** — user defines a webhook URL and a data transformation template (e.g. map deploy event fields to a custom JSON shape)

---

## Environment variable live/rebuild UX

**Q**: Updating env vars — restart or live inject?

**A**: User chooses per variable. UX requirements:
- Visual badge per variable showing current mode: `● live` vs `⟳ requires redeploy`
- When an env-only change is deployed (no build change), the platform tracks it as an env-only deploy
- **Env rollback**: ability to rollback just the env vars (independently of the image) with warnings explaining what caused the rollback (e.g. "env var HOST was rolled back due to failed health check after deploy #42")

---

## Mobile / responsive

**Q**: Target device for the web dashboard?

**A**: Fully responsive first — usable on any screen size. PWA (installable on phone with offline view) is planned but not for v3 launch.

---

## White-labeling

**Q**: Should the platform support white-labeling?

**A**: Full white-label — orgs can have their own branded portal (custom logo, name, domain).
