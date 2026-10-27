# Observability & Notifications audit (v3)

Paths are relative to /home/sebille/Bureau/projects/tests/deployer/v3. Verified by reading source.

Two backends exist side by side. `apps/api` is the monolith. `apps/api-services/{bff,services/*}` is the new stack, and docs/API-CUTOVER-STATUS.md says ingress still defaults to the monolith. Analytics and push are implemented twice (monolith and `services/identity`), and the two copies behave differently. The web app's `service-surface.ts` wires `analytics`, `push` and `health` through the BFF, so the identity-service copies are the ones that matter going forward.

## 1. Feature inventory

| Feature | Status | Evidence |
|---|---|---|
| Liveness `/health`, readiness `/health/ready` per service | REAL | api-services/shared/src/server/service-health.ts (AllowAnonymous, 200/503, preflight-bound) |
| Health registry: parallel indicators with timeouts, 15 s cache, SSE `/health/stream` | REAL | shared/src/server/health/health-registry.service.ts, health.module.ts; indicators for db, migrations, redis, memory, disk |
| `svc-health` oRPC service (`check`, `detailed`) via BFF | REAL | services/health/src/modules/health/controllers/health.controller.ts; bff/.../generated/health.delegation.ts |
| Health `detailed` `uptime` | BUG | `process.uptime()/1000` at services/health/.../health.controller.ts (already in seconds; reports 1000x too small). `supervisors: []` is hardcoded |
| Monolith `/health`, `/health/ready`, `/health/detailed` | REAL | apps/api/src/modules/health/* (Terminus: database, swarm, services, mesh; supervisor health; transition logging) |
| Health registry `changes$` consumers | MISSING | Only the SSE controller subscribes. No logger, alert or persistence |
| Per-service live health monitoring (HTTP/TCP/docker/command probes, history) | MISSING (schema only) | `healthChecks`, `serviceHealthConfigs`, `healthCheckJobs` tables in packages/nest/schema/src/global/health/health.ts. No reader or writer anywhere. No cron job |
| "Service health" in analytics | PARTIAL (derived) | identity analytics.service.ts: status is derived from the latest deployment row. Uptime is hardcoded 0 in identity (computed in the monolith). Not a live probe |
| Deploy-time health gate | REAL | runtime deployment-execution-workflow.service.ts (healthCheckUrl, maxRetries, retry interval) |
| Host CPU/mem/disk/net analytics (identity) | PARTIAL / misleading | identity analytics.service.ts `takeSnapshot()` runs systeminformation inside the identity container. It reports that container's view, labelled `dataSource:"docker"`. Network is `rx_sec` of the first interface, and the `networkOutbound` ternary tests `primaryDisk`. No history: one sample is copied across every bucket |
| Host metrics (monolith) | PARTIAL | apps/api analytics.service.ts: `dockerContainerStats` summed. `cpuPercent` is averaged across containers, so it is not host CPU. Needs the docker socket |
| Application / database / API-usage / user-activity / activity-summary metrics | STUB (honest) | All return `dataSource:"unavailable"` with empty data (both backends). No APM, no pg_stat collector, no request logging, no audit log |
| Deployment analytics (counts, success rate, durations, rollbacks, failure reasons) | REAL | analytics.repository.ts reads `deployments` and `deploymentRollbacks`. Aggregation in analytics.service.ts |
| Analytics dashboard page | REAL (narrow) | apps/web/src/app/dashboard/analytics/page.tsx: resource snapshot, deployment bars, service-health list, summary. It states plainly when a source is unavailable. Uses 4 of the 19 procedures |
| Reports and report configs: CRUD in the DB | PARTIAL | `generateReport` snapshots the live metrics into a JSON row. Format `pdf`/`csv` is accepted but the content is always JSON. The report window is anchored at now, not `period.start` (identity `rangeFor`). The `schedule` and `recipients` columns are stored and never executed |
| Report download | BROKEN (identity/BFF) | identity returns `downloadUrl=/analytics/reports/:id/content`. No route serves it anywhere in bff or identity. The monolith has `AnalyticsDownloadController` (`/api/analytics/reports/:id/download`) but its URL differs |
| Reports UI | MISSING | `domains/analytics/hooks.ts` defines hooks. No page uses them |
| Node system metrics (`meshContract.getNodeMetrics`) | PARTIAL | shared/src/core/modules/system-metrics: 15 s cache, CPU/mem/disk/net/process/GPU. Exposed via BFF mesh delegation. No web caller. The QA doc's "project admin with node affinity" is unimplemented (`requireAuth()` only) |
| Container metrics stream | REAL (backend) | runtime docker-container-metrics-stream.service.ts, 400 ms polling of docker stats. UI use not verified in depth |
| Container logs: snapshot and stream, mesh-routed | REAL | runtime docker-container-logs-domain.service.ts, docker-container-runtime-mesh.service.ts. Web: dashboard/docker/logs/* and use-container-stream-logs.ts |
| Deployment logs | REAL | `deploymentContract.getLogs` -> `deploymentRepository.findLogs`, paged, with filters. Web: deployment-logs-viewer.tsx |
| Runtime events feed | REAL | use-runtime-event-logs.ts consumes the docker entity stream |
| Log aggregation / retention / search across services | MISSING | No Loki/ELK, no persistent app-log store. Per-container docker logs only |
| Logger package | REAL | packages/infrastructure/logger: pino, redaction paths, context filter. No remote transport, no correlation or trace ids, no metrics |
| Event bus (packages/nest/events) | REAL | RxJS/Zod typed streams, pooled. Internal plumbing only. It is not an audit log or notification bus |
| Audit log | MISSING | No table, writer or UI (grep for audit). `getUserActivity` is an empty stub |
| Web push: subscription management | REAL (backend and settings UI) | identity push.service.ts (https endpoint check, key shape checks, VAPID per user). UI: components/push-notifications/PushNotificationSettings.tsx on /auth/me |
| Web push: actually sending | STUB / MISSING | Identity `sendTestNotification` never sends. It returns `{success: min(total, deliverable), failed, total}`, a fabricated delivery report (push.controller.ts). `recordDelivery` has zero callers. Identity never imports `webpush.sendNotification`. The monolith has a real `sendToUser`, but only the test endpoint calls it |
| Service worker | BROKEN | apps/web/src/app/sw.ts is a bare Serwist precache with no `push` or `notificationclick` handler. Nothing builds or registers it: no serwist hit in next.config.ts, no `serviceWorker.register`, no `/sw.js` in public. `subscribe()` throws "Service worker not registered". `navigator.serviceWorker.ready` at line 88 never resolves |
| Alerting: email / Slack / Discord / webhook | MISSING (config only) | Project notification settings (`slackWebhookUrl`, `emailRecipients`, `notifyOnDeploymentFailure`, `notifyOnServiceDown`) are persisted by project.service.ts and shown in ProjectConfigSections.tsx. No consumer sends anything. No mailer or Slack/Discord code anywhere. `serviceHealthConfigs.alertWebhookUrl/alertEmail` are unused |
| Uptime checks / status page | MISSING | No scheduled probe, no public status page |
| Metrics export (Prometheus/OTel) | MISSING | No metrics endpoint |
| Event-driven notifications (deploy success/fail, node down) | MISSING | Nothing emits to push or any other channel |

## 2. What works end to end

- Container and deployment health probes: `/health` and `/health/ready` on every service, with a cached registry and SSE stream.
- Deploy-time health gate with retries.
- Deployment analytics page: real DB aggregates, with honest "no data source" badges.
- Deployment log viewer (paged, filtered).
- Docker container log and event streaming through the mesh.
- Push subscription bookkeeping (VAPID key per user, subscribe, unsubscribe, stats). The backend works, but the browser cannot complete it because of the service worker problem below.

## 3. Broken or risky

1. The service worker is never built or registered, so no browser can subscribe. Even if it were, there is no `push` handler to show a notification.
2. Identity `sendTestNotification` fabricates a delivery report. The UI will show "sent" when nothing was sent.
3. Nothing ever sends notifications on platform events. The notification settings in project config are decorative, and the UI toggles imply behaviour that does not exist. This is the most misleading gap in the area.
4. Per-user VAPID keypairs are stored as plaintext private keys. The subject is a fake `mailto:user-<id>@notifications.local`, which Apple and Mozilla push services may reject. A single server-wide VAPID identity (configurable contact) is the standard design.
5. `upsert` and the monolith's `updateSubscription` re-bind an existing endpoint to whichever user submits it. The endpoint is secret, but a stolen endpoint can hijack a device row.
6. The analytics report download URL is a dead link on the BFF/identity path. `pdf`/`csv` reports are not generated. The report window ignores the requested period.
7. Resource metrics in identity measure the identity container, not the node, yet carry `dataSource:"docker"`. There is no history, so the flat series is visually a "trend".
8. `svc-health` `uptime` is off by 1000x. `supervisors` is always `[]`.
9. Health `changes$` has no subscriber, so down/up transitions are never logged or alerted. Only the monolith's `ReadinessService` logs transitions.
10. Authorization is weak. Analytics, deployment logs, node metrics and health `detailed` check only `requireAuth()`. There is no role or project scoping, even though the QA doc asks for "project admin with node affinity". Any viewer sees platform-wide data.
11. Duplicated implementations (monolith and identity) have already diverged: uptime computation, download route and the `sendToUser` implementation.
12. Test coverage: the analytics page test (`analytics.states.test.tsx`) is a generic states harness. The identity push `sendTestNotification` path is untested against a real transport.

## 4. Required for production (ordered)

1. Wire the service worker: use serwist's Next integration, or a `/sw.js` route, plus registration in the root layout. Add `push` and `notificationclick` handlers.
2. Decide on one VAPID identity (env `VAPID_PUBLIC/PRIVATE/SUBJECT`) and drop per-user key storage, or encrypt the stored private keys. Use a real contact subject.
3. Build a `NotificationService` in identity (or a new `notify` module) with channel adapters: web-push (real `webpush.sendNotification`, 404/410 pruning through the existing `recordDelivery`), email (SMTP), and Slack/Discord/generic webhook (with SSRF-safe URL validation).
4. Emit domain events and subscribe to them. The runtime service emits deployment succeeded/failed. The fleet service emits node down. The health registry `changes$` emits service/dependency down. A dispatcher reads the project notification settings and fans out.
5. Replace the fake `sendTestNotification` with a real send.
6. Implement real per-service health monitoring: a scheduler using `serviceHealthConfigs`, writing `healthChecks` with retention, using http/tcp/docker probes executed on the node that owns the service (mesh), and feeding the status into the analytics "Service health" card.
7. Fix the report path: a content route on the BFF, real CSV (and PDF or drop it from the contract), period-correct windows, and a scheduler for `schedule` and `recipients`.
8. Make node metrics real: collect from the host or agent (the mesh agent), not the identity container. Persist a time series, even a ring buffer of 15 s samples with downsampling.
9. Add role and project-scoped authorization (admin for node and platform metrics, members for their own project).
10. Retire the duplicated monolith modules once ingress flips to BFF, or share one implementation.

## 5. Recommended enhancements

- Fix `uptime` in `svc-health`, and populate `supervisors` or drop the field.
- Surface the Terminus indicators (`health.detailed`) in a Platform health page. Currently only the web middleware and one route call `health.check`.
- Wire the existing container metrics stream to a per-service metrics tab.
- Add a web UI for the deployment and platform log viewer to filter by node and service.
- Correlation ids across BFF to service to runtime in logs (the logger has the redaction and context-filter foundation).
- Add integration tests for push (mock web-push), the dispatcher and the retention job.
- Show the `dataSource` honesty pattern on reports too.

## 6. Recommended new features

- Notification centre (in-app inbox) with per-user and per-project rules and quiet hours.
- Alert rules on metrics (CPU/mem/disk thresholds, deploy failure rate), with deduplication and escalation.
- Public or private status page, per project, with uptime history and incident notes.
- Audit log: who deployed, changed settings, rolled back, with a UI and export.
- Prometheus/OpenTelemetry endpoint and optional Loki shipping. Persistent log storage with retention and search.
- Synthetic uptime checks from multiple mesh nodes. Certificate and domain-expiry checks.
- Weekly digest emails using the report-config scheduler.
