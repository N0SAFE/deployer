# Core Services Production Readiness Audit

Date: 2025-12-09
Scope: `apps/api/src/core/modules/*/services` (core infrastructure services)

## Summary
This document consolidates a full pass review of the repository's core services and provides actionable remediation steps for production readiness. It is based on a line-by-line audit of the core modules and covers:

- Executive summary and readiness score
- Per-module findings (Critical / High / Medium / Low)
- Concrete fixes, tests, and monitoring required
- A prioritized remediation plan with verification steps
- Admin guidance to "Enable GPT-5.1-Codex-Max (Preview)" (administrative steps only)

### Overall readiness score: 5.5 / 10
Major blockers exist (see CRITICAL items). Do not deploy to production until CRITICAL items are fixed.

---

## Executive summary (top risks)

Critical (must fix before production)
- Missing DB transaction boundaries in deployment flows → risk of inconsistent state and data loss
- Race conditions when manipulating containers/networks → risk of resource conflicts and partial cleanup
- Path traversal in `StorageService` → immediate security vulnerability
- Builder/orchestrator not propagating builder failures → deployments can be marked successful when they failed
- Certain features left as mocks (e.g., backup) that are required in production

High (fix before launch if possible)
- Lack of retry/backoff and circuit-breaker patterns for network calls (Docker pulls, remote provider calls)
- Missing input validation in rule engine and some public APIs
- Insufficient container state verification after start

Medium/Low
- Inconsistent logging levels and missing structured metadata (request/correlation IDs)
- Missing test coverage for concurrent and failure scenarios
- Minor type-safety and documentation gaps

---

## Module-by-module findings and recommended fixes

Note: severity tiers map to the following recommendations:
- CRITICAL — block deployment until fixed
- HIGH — fix before production launch
- MEDIUM — improve before scaling
- LOW — nice-to-have improvements

### deployment/ (Score: 4/10)
Key service files reviewed: `DeploymentService`, `DeploymentOrchestrator`, `deployment-cleanup.service.ts`, `deployment-health-monitor.service.ts`, `deployment-strategy-executor.service.ts`, `enhanced-deployment-rules.service.ts`, `preview-deployment.service.ts`, `custom-condition-registry.service.ts`.

Findings
- CRITICAL: Multi-step deployment flows perform multiple DB updates without transactions leading to inconsistent state on partial failures.
- CRITICAL: Cleanup operations log failures but do not surface or schedule follow-up cleanup tasks (disk/volume leakage risk).
- CRITICAL: Container list + removal uses check-then-act pattern without locks leading to race conditions.
- HIGH (partially mitigated 2025-12-09): Orchestrator now surfaces builder errors explicitly, but persistence/state rollback for failed builds still needs transaction support.
- HIGH: `EnhancedDeploymentRulesService.evaluateRuleWithContext` lacks input validation for malformed rules and does not evaluate `metadata.customCondition` (incomplete feature). `CustomConditionRegistry` exists but is not wired into the evaluator, so custom predicates are never executed.
- HIGH (partially mitigated 2025-12-09): Health checks hardened in `DeploymentOrchestrator.runHealthCheck` (real HTTP check with timeout + retries/backoff). `DeploymentService.verifyContainerHealth` still performs a single fetch with no retries; `DeploymentHealthMonitorService` still relies on shallow signals.
- HIGH: `DeploymentHealthMonitorService` relies on the same shallow health signal and will mark deployments failed/restart containers without real reachability/health verification or backoff; no per-deployment throttling or auth-aware HTTP checks.
- MEDIUM: `DeploymentService.deployDockerService` builds container health URLs with `localhost`/container name but does not verify network reachability; aborts after one attempt and may mark partial success incorrectly.
- MEDIUM: Node/Python Dockerfile generation writes files directly to `buildContext` without cleanup or validation; may overwrite user Dockerfiles silently.
- MEDIUM: `DeploymentCleanupService` deletes historical deployments synchronously and best-effort only; failures are just logged (no retry job), and artifact cleanup is skipped for many cases (images if keepArtifacts=true by default, static files only when builder === 'static').
- MEDIUM: `DeploymentStrategyExecutor` blue-green/canary/rolling strategies are placeholders that simply run standard deploy, so users choosing these strategies get no isolation or rollback semantics.
- MEDIUM: `PreviewDeploymentService.deletePreviewDeployment` only sets status to `cancelled` and does not deregister routes, remove containers/images, or reclaim storage; update path is a placeholder.

Fixes
1. Wrap deployment creation and status transitions in database transactions (use the project's DB transaction API or ORM transaction helper). Ensure rollback on failure.
2. Convert `cleanup` to a best-effort synchronous attempt then schedule guaranteed asynchronous cleanup job (e.g., queue a cleanup job with retries). Record cleanup failure in deployment metadata.
3. Replace check-then-act patterns for container/network creation/removal with atomic Docker operations where possible; otherwise use a distributed lock (DB row lock or Redis lock) around the critical section.
4. Make builder result mandatory: orchestrator must inspect `builderResult.status` and propagate errors to deployment state (log and set status=failed, capture builder logs).
5. In `EnhancedDeploymentRulesService.evaluateRuleWithContext` add input validation, safe handling of unknown metadata keys, and register/evaluate custom condition predicates or reject unknown conditions.
6. Implement real health checks: add retry/backoff, handle DNS/port reachability, and fail deployments when health checks time out; make `runHealthCheck` async and propagate failures. Extend `DeploymentHealthMonitorService` to use the same hardened check, include auth headers, add per-deployment throttling, and avoid aggressive auto-fail on transient blips.
7. Guard generated Dockerfile writes (Node/Python) with existence checks and cleanup temp artifacts; respect existing Dockerfiles.
8. Convert cleanup into a durable workflow: enqueue cleanup jobs with retries, track failures in metadata, and ensure artifacts (containers/images/static files) are removed even when keepArtifacts=false. Add coverage for failed and preview deployments too.
9. Hide or explicitly mark strategy options (blue-green/canary/rolling) as unsupported until implemented; or implement real orchestration (two-slot deployment, traffic switch, rollback) before exposing.
10. Add real preview lifecycle management: on delete, tear down containers/images/routes/storage and deregister from Traefik; on update, perform rolling replacement or recreate deployment.

Tests & verification
- Unit tests covering transaction rollbacks (simulate error mid-flow)
- Integration tests that simulate partial failures (builder crash, DB fail) and verify consistent state
- Concurrency tests for multiple parallel deployments to expose race conditions

Monitoring
- Add metrics: deployments started/succeeded/failed, cleanup failures, retry counts
- Add logs containing correlation id (deploymentId) for distributed tracing

---

### docker/ (Score: 5/10)
Key service files reviewed: `DockerService` and helpers.

Findings
- CRITICAL: Image pull and other network calls lack retry/backoff and circuit-breakers. Network flakiness can cause deploy failures.
- CRITICAL: `start` and `exec` operations do not verify container health or handle socket closure gracefully.
- HIGH: No verification loop after container start to ensure container entered running and healthy state (i.e., liveness probe checks).

Fixes
1. Add a retry wrapper with exponential backoff to all external network operations (image pull, registry calls, downloads).
2. After `container.start()`, poll container state with timeout and verify health (if the container supports a health check) before marking deployment success.
3. For `exec` streams or socket-based operations, register error/close handlers and timeouts; perform retries or fail fast with cleanup if stream is broken.
4. Use idempotent Docker APIs (createIfNotExist semantics) or distributed locking around network creation.

Tests & verification
- Unit tests for retry wrapper and backoff behavior
- Integration tests pulling large images with simulated network faults
- E2E test where containers crash on start to verify rollback and logs

Monitoring
- Export metrics: pull success/fail, container start latency, exec failures

---

### traefik/ (Score: 6/10)
Key files: Traefik orchestration & validation services

Findings
- HIGH: Deprecated services still used; migration path is unclear.
- HIGH: SSL cert storage without validation
- HIGH: Check-then-create pattern for Docker networks leads to race

Fixes
1. Migrate deprecated service usages to canonical `TraefikCore` implementations; create a clear migration plan and deprecation timeline.
2. Validate certificates (PEM parse, expiry date) before insertion into DB or config store.
3. Use idempotent operations or locks when creating networks or shared Docker resources.

Tests & verification
- Integration tests creating/updating routes and certs

---

### providers/ (Score: 7/10)
Key files: provider registry and provider implementations (GitHub/static)

Findings
- MEDIUM: Registry methods return `null` silently; callers must handle it consistently.
- MEDIUM: Missing metrics for provider call latency / failure counts

Fixes
1. Make registry `getProvider()` throw a typed `ProviderNotFound` or return Result<T,Error> so callers must handle it explicitly.
2. Add metrics and circuit breaker for provider external calls.

Tests
- Unit tests for registry behavior and error cases

---

### builders/ (Score: 7/10)
Key files: DockerfileBuilderService, NixpackBuilderService (etc.)

Findings
- MEDIUM: Builder errors not always surfaced to orchestrator (some builders swallow errors)
- LOW: Missing usage metrics

Fixes
1. Ensure all builders throw on unrecoverable errors and return structured status objects for orchestrator to consume.
2. Add usage metrics.

---

### storage/ (Score: 4/10)
Key files: `StorageService` (read/write, path resolution, backup)

Findings
- CRITICAL (fixed 2025-12-09): `resolvePath` allowed path traversal (missing strict normalization and base path check). Implemented base-path containment guard and added unit tests covering traversal/absolute inputs.
- HIGH: No file size limits or streaming for large uploads (OOM risk)
- HIGH: Backup logic is mocked in production code

Fixes
1. Fix path resolution: after normalization, verify resolved absolute path starts with the configured storage base path; reject otherwise.
   - Use `path.resolve(basePath, relativePath)` then check prefix.
2. Enforce file size limits on uploads and use streaming (fs.createWriteStream) for large files.
3. Replace mock backup with real backup implementation (DB dump/pg_dump integration or cloud snapshot) or clearly mark as experimental and disable in prod.

Tests
- Security tests for path traversal
- Upload large file tests (streamed)

---

### database/ (Score: 7/10)
Key files: DB connection, migrations, health checks

Findings
- MEDIUM: Health checks perform a trivial `SELECT 1` but do not monitor connection pool saturation
- LOW: Error messages lack contextual details

Fixes
1. Extend health checks to include pool metrics (active, idle, waiting) and surface alerts when thresholds crossed.
2. Improve error messages with connection info (not secrets)

---

## Cross-cutting recommendations

1. Error handling pattern
   - Standardize on: try/catch → log with structured metadata → rethrow or return Result type
   - Use typed exceptions for common cases (NotFound, ValidationError, ExternalServiceError)

2. Transactions
   - Identify all multi-step DB flows and ensure they run in a transaction. If some steps are external (Docker), consider compensating transactions and explicit state machines.

3. Concurrency
   - Use distributed locks for non-idempotent resource operations (networks, named volumes). Use DB row locks or Redis locks.

4. Retries & Circuit breakers
   - Wrap external calls with retry + exponential backoff and add circuit breakers (e.g., `opossum` pattern or built-in provider wrappers)

5. Observability
   - Add structured logs with `deploymentId` or `requestId`
   - Add metrics for critical flows (deployments, builds, provider calls)
   - Add traces (OpenTelemetry) to track cross-service flows

6. Security
   - Fix path traversal immediately
   - Validate inputs for rule engine and any string-patterns from DB
   - Store only validated certificate paths and secrets

7. Tests
   - Add unit tests for all services
   - Add integration tests for deployment, builder failure modes, container crash handling
   - Add E2E tests simulating multi-node deployments

---

## Prioritized remediation plan (short-term / medium-term)

Short-term (days)
1. Fix path traversal in `StorageService` (CRITICAL)
2. Add transaction wrapping for deployment flow (CRITICAL)
3. Make orchestrator propagate builder failures and record builder logs (CRITICAL)
4. Add container start verification loop (HIGH)

Medium-term (weeks)
5. Add retry wrappers and circuit breakers for network calls (HIGH)
6. Replace mocked backup with production backup strategy (HIGH)
7. Add distributed locking for network/container critical sections (HIGH)
8. Add observability (metrics, traces, structured logs) (MEDIUM)

Long-term (weeks → months)
9. Add full E2E and chaos tests for failure injection
10. Harden provider integrations and add per-provider circuit-breakers

---

## How to validate a fix (example: path traversal)

1. Implement fix in `StorageService.resolvePath`:
   - Use `path.resolve(basePath, relativePath)` and verify the result startsWith basePath
   - Reject paths that do not satisfy

2. Add unit tests: passing, `../../etc/passwd` should be rejected
3. Add integration test that attempts upload + read outside the base path
4. Deploy to staging and run security scan

Verification commands (run from repo root):
```bash
# run unit tests
bun run test

# run specific package tests (API)
bun run api -- test

# run lint
bun run lint
```

---

## Creating GitHub issues & tracking
For each CRITICAL/HIGH item create an issue with:
- Title: short description (e.g., "CRITICAL: Path traversal in StorageService")
- Reproduction steps, logs, file/line references
- Suggested fix and code pointers
- Tests to add and required acceptance criteria

I can create these issues for you if you want and populate them from this document.

---

## Enabling "Enable GPT-5.1-Codex-Max (Preview) for all clients"

Note: enabling a preview model for all clients is an administrative action outside repository code. I cannot enable provider-managed features from within the repo. Below are step-by-step *administration* instructions you can follow (adapt to your provider):

1. Identify the platform where you want to enable the model (OpenAI, internal LLM platform, Copilot/Enterprise, etc.)
2. Login as organization admin and navigate to model/feature settings or beta program management.
3. If using OpenAI platform and you have an organizational UI that supports model gating, enable the `gpt-5.1-codex-max` preview flag for your organization or workspace. If no UI is present, consult support/contact or use provider API (if available) to opt-in.
4. Update any client libraries or server-side routing that pins models to use the new model id (e.g., replace model names in service config with `gpt-5.1-codex-max`). Keep a feature flag in your application to roll back quickly.
5. Inform users of the feature and any usage or billing changes; update documentation.

Caveats
- Preview models may have quota/cost implications; check billing and throttling limits.
- Security and compliance review may be required before enabling across all clients.

If you tell me which platform (OpenAI / GitHub Copilot for Business / other), I will produce exact admin API calls and step-by-step commands.

---

## Appendix: quick checklist to mark production-ready
- [ ] All CRITICAL items fixed and regression-tested
- [ ] All deployment flows wrapped in transactions or made idempotent with compensation
- [ ] Path traversal and input validation problems fixed
- [ ] Retry/circuit-breaker strategy implemented for external calls
- [ ] Observability (metrics/traces/logging) present for critical flows
- [ ] Integration/E2E/chaos tests cover common failure modes
- [ ] Documentation updated and runbook for incidents created

---

If you want, I will:
- Create GitHub issues for the CRITICAL and HIGH items (auto-populate with reproduction and proposed patch)
- Start implementing the top 3 CRITICAL fixes (choose which one to start with)
- Produce per-file patch suggestions for each fix

Tell me which next step you'd like me to take.
