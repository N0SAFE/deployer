# UI Copy & Micro-UX Patterns — Production Service Dashboard

Research for the Docker-deployment platform. Sources: Vercel deployment docs & REST API (verified live), GitHub Deployments REST API (verified live), Coolify KB (downloaded), Carbon Design System empty-state pattern, Material 3 content-design (AP Style, sentence case), Atlassian voice & tone, Kubernetes deployment semantics.

---

## (a) Deployment state copy table

Real-world vocabulary (verified): Vercel `readyState` = `QUEUED | INITIALIZING | BUILDING | READY | CANCELED | ERROR | BLOCKED` with lifecycle `QUEUED → INITIALIZING → BUILDING → READY | ERROR` and `readySubstate` = `STAGED | ROLLING | PROMOTED`. GitHub statuses = `queued | in_progress | pending | success | failure | error | inactive`. Docker = `created | running | paused | restarting | exiting | dead`.

| Canonical label | Description (microcopy) | Color | Notes / sources |
|---|---|---|---|
| **Queued** | "Waiting for a build slot to open up." | Yellow | GitHub `queued`. Use for deployments waiting on build capacity. |
| **Initializing** | "Preparing the build environment and fetching source." | Yellow | Vercel `INITIALIZING`. Optional step — can merge into Building if you don't have it. |
| **Building** | "Building the container image from source." | Blue (or Yellow if no blue in your system) | Vercel `BUILDING`, Coolify "building". Animated — the most common "in progress" state. |
| **Deploying** | "Starting new containers and routing traffic." | Blue | Coolify "deploying". Covers image pull + container start + rollout. |
| **Rolling back** | "Reverting to the previous deployment. Traffic is being rolled back." | Amber | Distinct verb — keeps "deploying" reserved for forward progress. |
| **Ready** | "Deployment is live and serving traffic." | Green | Vercel `READY`, GitHub `success`. Terminal success. |
| **Degraded** | "Running, but some replicas are unhealthy or health checks are failing." | Amber | K8s `Degraded`. See (c). |
| **Failed** | "Deployment failed. Check the build and runtime logs." | Red | Vercel `ERROR`, GitHub `failure`. Always link to logs. |
| **Cancelled** | "Deployment was stopped before it finished." | Gray | Vercel `CANCELED`, GitHub `cancelled` (GH Actions). User-initiated or superseded. |
| **Superseded** | "A newer deployment replaced this one." | Gray | Vercel shows older deployments this way. Do NOT call it failed. |
| **Blocked** | "Waiting for approval before this deployment can build." | Yellow/Gray | Vercel `BLOCKED`. Only if you have approval gates. |
| **Stopped** | "The service is stopped. No containers are running." | Gray | Docker `exited`. Runtime state, not deployment state. |

Rules:
- Sentence case everywhere (M3, AP Style): "Ready" not "READY", "Rolling back" not "Rolling Back".
- In-flight states take the **animated** dot; terminal states take the **static** dot.
- "Failed" is never the only signal: pair with a "View logs" link.
- Never label a superseded deployment "Failed" — gray, not red. Red is only for user-actionable failures.

---

## (b) Four empty-state copy blocks

Structure (Carbon + M3 consensus): **Illustration/icon (low-contrast, ~48px) → Title (short, specific) → Description (why it's empty + what happens next, 1–2 lines) → Primary action (specific verb) → optional secondary (docs link)**.

### 1. No deployments
- **Title:** "No deployments yet"
- **Description:** "Deployments appear here when you push code or trigger a build. Your first deployment takes about two minutes."
- **Action:** "Deploy your first service"
- **Secondary:** "View deployment docs"

### 2. No sub-services
- **Title:** "No sub-services yet"
- **Description:** "Sub-services are the containers that run alongside your main service — databases, workers, and cron jobs. Add one to get started."
- **Action:** "Add sub-service"

### 3. No dependencies
- **Title:** "No dependencies yet"
- **Description:** "Link the services your project needs to run, like Postgres or Redis. They start automatically before each deployment."
- **Action:** "Add dependency"
- **Secondary:** "Browse templates"

### 4. No environment variables
- **Title:** "No environment variables yet"
- **Description:** "Environment variables are injected into your service at runtime — API keys, database URLs, and other secrets. They're encrypted at rest."
- **Action:** "Add environment variable"

Rules:
- Title: noun-first, sentence case, ≤ 6 words.
- Description explains *why it's empty* and *what happens next* — never just repeats the title.
- Empty **filtered** lists are different: "No deployments match these filters" + "Clear filters" (no illustration, compact).
- One primary action max. No empty state with three buttons.
- Never say "Nothing here" or "No data" — say what the *user* can create/do.

---

## (c) Status color semantics table

| Semantic | Color | States it maps to | Rules |
|---|---|---|---|
| **Healthy / Success** | Green | Ready, Running, Live, Healthy | Only for states that are fully working right now. |
| **In progress** | Blue | Building, Deploying, Syncing | Progressive action. Animate. Never use blue for errors. |
| **Pending / Warning** | Yellow/Amber | Queued, Initializing, Blocked, **Degraded**, About to expire | "Wait" or "mostly fine but look here". |
| **Error / Critical** | Red | Failed, Down, Crash loop | Only user-actionable failures. Pair with "View logs". |
| **Neutral / Disabled** | Gray | Cancelled, Superseded, Stopped, Paused, Unknown | Terminal, non-alarming. |

**What "Degraded" means:** the resource is running but not fully healthy — e.g. 2 of 3 replicas available, or health checks failing while the service still answers requests. It is **amber**: traffic is served, capacity/reliability is reduced. It is not red (not down) and not green (not fully healthy).

**How to show Degraded:** amber badge labeled "Degraded" + supporting line in the row or tooltip: "2 of 3 replicas available". Pattern: `Degraded — 2/3 replicas available`.

**Non-negotiable rules:**
- Never rely on color alone (WCAG 2.1): every badge has a text label + icon.
- Same semantic = same color everywhere (one source of truth — e.g. a `STATUS_VARIANTS` config).
- Keep colors distinct between light/dark modes; check contrast (green-on-white is notoriously weak).
- Filled dot = current state; muted/outline dot = historical state in lists.

---

## (d) Destructive confirm copy patterns

Structure (Carbon/Atlassian/industry): **Title "[Verb] [object]?" → 1–2 consequence sentences (what's removed, what's affected, what's NOT affected, undo path) → destructive button repeating the verb**.

Copy patterns — pick per severity:

| Severity | Example copy | Button |
|---|---|---|
| Reversible (stop, pause) | "Stop api-gateway? No traffic will reach this service until you start it again." | "Stop service" (normal) |
| Destructive, contained | "Delete sub-service worker-1? It will be removed from this deployment and stopped. The parent service web won't be affected." | "Delete sub-service" (red) |
| Irreversible + data loss | "Delete api-gateway? This will stop all traffic and permanently delete the service and its attached volumes. This action can't be undone." | "Delete service" (red) |
| Irreversible + type-to-confirm | "Delete project production? Type the project name to confirm. All deployments, logs, and volumes will be permanently deleted." | Input + "Delete project" (red, disabled until typed) |

Rules:
- Title ≤ 8 words, ends with "?", verb + object ("Delete sub-service?" — never "Are you sure?").
- **Button repeats the action verb + object** — "Delete sub-service", never "OK" / "Yes" / "Confirm".
- State the *consequence*, not the process: "traffic stops immediately" not "the deployment will be processed".
- Explicitly say what is NOT affected when scope is narrow ("web won't be affected") — reduces anxiety.
- "This action can't be undone" — only when literally true. Don't lie.
- Irreversible + data loss → type-to-confirm (GitHub pattern).
- Destructive button uses the destructive color, separated from Cancel. Focus lands on Cancel (or the type-to-confirm input), not the destructive button.
- Cancellation (Vercel's Cancel Deployment) is *not* destructive → plain confirm, "Yes, cancel deployment" / "Keep building".

---

## (e) Metric label conventions

| Metric | Label | Value format | Tooltip |
|---|---|---|---|
| CPU | **CPU usage** | "42%" (0–100% of allotted cores) | "Average CPU usage over the last 5 minutes." |
| Memory | **Memory** | "1.2 GB / 2 GB" or "60%" | "Memory used by all containers in this service." |
| Network I/O | **Network I/O** | "↓ 3.2 MB/s ↑ 1.1 MB/s" | "Inbound and outbound traffic over the last 5 minutes." |
| Disk I/O | **Disk I/O** | "↓ 12 MB/s ↑ 4 MB/s" (read/write) | "Disk reads and writes over the last 5 minutes." |
| Restarts | **Restarts** | "3" | "Times the container restarted in the last 24 hours." |
| Replicas | **Replicas** | "2 / 3 healthy" | "Containers currently passing health checks." |

Conventions:
- Sentence case, noun-first, no colons, no icon needed: "CPU usage", "Memory", "Network I/O".
- **Always carry a unit or scale hint**: % for CPU, bytes for memory, /s for I/O.
- **Replicas = "healthy/total"** ("2 / 3 healthy"), colored by the ratio — green ≥ all, amber partial, red none. Not a bare percentage.
- Arrows (↓ ↑) for bidirectional I/O; keep RX/TX order consistent.
- Tooltip states the time window — the label alone can't.
- Put labels in one config (SSOT): same string in cards, table headers, tooltips.
- Ordering: CPU → Memory → Network I/O → Disk I/O → Restarts → Replicas (usage first, counts last).

---

## (f) Five micro-UX polish tips

1. **Shimmer skeletons, not spinners, for known-shape content.** Render skeleton blocks that match the final layout (row height, badge circles, sparkline shape), shimmer via a moving gradient (`background-position` animation, ~1.5–2.5 s loop). Add `aria-busy="true"` + `aria-label="Loading…"`. Disable shimmer under `prefers-reduced-motion`. Never shimmer past ~3 s without showing a fallback (error/retry).

2. **Fast, opacity/transform-only transitions.** 150–200 ms for micro-interactions (hover, badge swap), 200–300 ms for state changes; cross-fade badge color changes instead of snapping; slide new table rows in. Animate only `transform`/`opacity` (compositor-friendly), and gate all animation behind `prefers-reduced-motion: reduce`.

3. **Intl-driven number formatting.** Use `Intl.NumberFormat` everywhere: percentages as whole numbers (`42%`, not `42.31%`); bytes → human units (`1.2 GB`, not `1,238,412,342 bytes`); durations as `1m 23s`; relative times as "2 min ago" with the exact timestamp on hover. Add `font-variant-numeric: tabular-nums` on all numeric cells so digits don't jitter while updating.

4. **Status dot + label, pulse only when active.** Every colored badge ships with its text label; add a slow pulse animation (2 s) exclusively to in-progress states (Building, Deploying, Rolling back). In history lists, render the current state as a filled dot and past states as muted outlines — visual hierarchy without new colors.

5. **One help mechanism per element — tooltip XOR inline helper.** Definition ("What is a replica?") → info-icon tooltip: opens on hover *and* focus (keyboard), ~500 ms delay, no interactive content inside, dismiss on Escape — it's never the only carrier of critical info (no hover on mobile). Instruction ("DATABASE_URL=postgres://…") → persistent inline helper under the field. Never stack both on the same field; errors are inline, not tooltips.

---

## Tooltip vs inline help quick decision

| Situation | Use |
|---|---|
| "What does this term mean?" (definition) | Info-icon tooltip |
| "What format / what do I type here?" (instruction) | Inline helper under the field |
| "Your input is invalid" (error) | Inline error, never a tooltip |
| Action available inside the popover | Not a tooltip — use a popover/dialog |
| Critical info (billing, data loss) | Never tooltip-only — inline or always visible |

---

## Sources
- Vercel docs — `/docs/deployments`, REST API `POST /v13/deployments` (`readyState`, `readySubstate` enums), "Production deployment state" (Staged/Rolling/Promoted).
- GitHub REST API — Deployments endpoints (`queued | in_progress | pending | success | failure | error`, `inactive`/`destroyed`).
- Coolify KB — deployment/build terminology ("building", "deploying", "failed", "stopped").
- Carbon Design System — empty-state pattern (illustration → title → description → action).
- Material 3 — content design (AP Style, sentence case, clear-to-anyone).
- Atlassian voice & tone, Kubernetes deployment conditions (`Progressing`, `Available`, `Degraded`).
