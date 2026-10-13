# 03 — Configurator Protocol

> **Status:** canonical
> **Answers:** how a browser configures a node that exposes no inbound port, and
> the exact message protocol between browser, relay and CLI.

Derived from the operator's configurator specification, adapted to Deployer's
existing primitives (oRPC contracts, Zod schemas, the mesh token machinery).

## 3.1 The shape

```text
     Browser                     Deployer infrastructure                    Node
        │                                   │                                │
        │  1. GET v34-1.config.../s/ABC     │                                │
        ├──────────────────────────────────►│  static UI (immutable build)   │
        │                                   │                                │
        │  2. wss://.../ws/ABC              │                                │
        │     (browser pairing secret)      │                                │
        ├──────────────────────────────────►│◄───────────────────────────────┤
        │                                   │  3. outbound WSS (CLI cred)    │
        │                                   │      the CLI DIALS OUT         │
        │  4. commands (configuration.*)    │                                │
        ├──────────────────────────────────►├───────────────────────────────►│
        │                                   │                                │  validate
        │  5. events (configuration.*, implementation.*)                     │  apply
        │◄──────────────────────────────────┤◄───────────────────────────────┤
        │                                   │                                │
```

Three properties are non-negotiable:

1. **The node never accepts an inbound connection.** The CLI dials out.
2. **The relay is version-neutral.** It routes messages; it does not know what a
   "domain" is.
3. **There is one shared relay for every configurator version.** Static UI is
   versioned and disposable; the relay is not.

## 3.2 The relay is NOT a platform service

The relay is **remote infrastructure** (or the CLI itself, in the local case).
It is deliberately *not* one of `apps/api/services/*`, because a fresh node has
no swarm and nothing running — there would be no host for it. See
[12](./12-architecture-review.md) §12.1 F1.

When self-hosting a relay is desired, it is a **separate deployable artifact**,
not an API service. It owns:

- session lifecycle and storage;
- the pass-through tunnel (browser ↔ CLI);
- protocol compatibility checks;
- serving/pairing the versioned static UI.

It owns **none** of the meaning: it never inspects a `configuration.update`
payload beyond validating that it matches the protocol schema.

## 3.3 Versioning model

Three independent versions. Never collapse them.

| Version | Example | Owned by | Purpose |
|---|---|---|---|
| deployment (CLI/build) version | `34.2.7` | release | what the operator runs |
| configurator UI version | `34-1` | release | which static bundle loads |
| protocol version | `4` | this document | message compatibility |

A UI version maps to a protocol version; several UI versions may share one
protocol version:

```text
v34-1 → protocol 4
v34-2 → protocol 4
v35-0 → protocol 5
```

The CLI resolves its required pair (`configuratorVersion`, `protocolVersion`) and
sends both at session creation. The relay **rejects** a session whose protocol
version it does not support — a configuration UI must never silently talk to an
incompatible node.

## 3.4 Session creation

```http
POST /session
content-type: application/json

{
  "configuratorVersion": "34-1",
  "protocolVersion": 4,
  "deploymentVersion": "34.2.7"
}
```

```json
{
  "sessionId": "ABC123",
  "browserUrl": "https://v34-1.config.example.com/s/ABC123",
  "cliTunnelUrl": "wss://config.example.com/ws/ABC123",
  "cliTunnelCredential": "<opaque, single-session, short-lived>",
  "expiresAt": "2026-10-09T15:02:00Z"
}
```

**Security invariants**

- `sessionId` is high-entropy and **not** a credential by itself.
- The browser credential is **never** sent as a plain query param; the UI reads it
  from the URL **fragment** (`#pair=…`) or from a pairing code, and strips it
  before any request.
- The CLI credential is separate from the browser credential, is scoped to one
  session, expires, and grants **no** access to other sessions or to the platform
  API.
- Sessions have an idle timeout **and** an absolute maximum lifetime.
- Pairing attempts are rate-limited.

## 3.5 Messages

Request/response/event. Not arbitrary frames.

### UI → CLI (commands)

```ts
type ConfiguratorCommand =
  | { type: 'configuration.update';  commandId: string; revision: number; payload: Configuration }
  | { type: 'configuration.validate';commandId: string; revision: number }
  | { type: 'implementation.start';  commandId: string; revision: number }
  | { type: 'implementation.cancel'; commandId: string; operationId: string }
  | { type: 'session.ping';          commandId: string };
```

### CLI → UI (events)

```ts
type ConfiguratorEvent =
  | { type: 'session.state';            revision: number; state: SessionState }
  | { type: 'configuration.accepted';   revision: number }
  | { type: 'configuration.validation'; revision: number; issues: ValidationIssue[] }
  | { type: 'implementation.started';   operationId: string; revision: number; step: string }
  | { type: 'implementation.progress';  operationId: string; revision: number; progress: number; message: string }
  | { type: 'implementation.log';       operationId: string; revision: number; level: 'info'|'warn'|'error'; message: string }
  | { type: 'implementation.completed'; operationId: string; revision: number; result?: unknown }
  | { type: 'implementation.failed';    operationId: string; revision: number; error: { code: string; message: string } };
```

Every message carries `commandId` (commands) or `eventId` + `sequence`
(events) so the two sides can reconcile after a reconnect.

## 3.6 Revisions — the correctness hinge

Configuration is **revisioned**, monotonically.

```text
revision 1   domain = foo.example.com     ← applied, succeeded
revision 2   domain = bar.example.com     ← applied, FAILED
revision 3   domain = baz.example.com     ← current, not yet applied
```

**Every implementation event names the revision it concerns.** The UI must render
the outcome *against that revision*, never against "the current one":

> If `implementation.failed` arrives for revision 2 while the editor shows
> revision 3, the failure belongs to a **stale** revision: show it as history, do
> not present it as the state of what is on screen.

Derived per revision: `latest` (highest), `editing` (highest not applied),
`applying` (in flight), `succeeded`, `failed`, `stale` (an applied target lower
than `editing`).

**Implementation is serialized.** At most one operation runs at a time. A new
`implementation.start` for a newer revision cancels the in-flight one
(cooperatively) rather than running two.

## 3.7 Delivery guarantees

| Concern | Guarantee |
|---|---|
| commands | at-most-once; `commandId` allows the CLI to dedupe a reconnect replay |
| implementation events | **idempotent by construction** — the UI can rebuild the latest state from the last event per `(operationId, revision)` |
| UI reconnect | `session.snapshot` first (§3.8), then the event stream |
| CLI reconnect | resumes the same session while valid; **never** restarts an implementation because a socket reconnected |

An `implementation.completed`/`failed` for a revision the CLI has since
superseded is still delivered — the UI decides how to display it, using the
revision.

## 3.8 State snapshot + stream

A reconnecting or refreshing UI must not depend on catching transient frames.

```ts
// GUI connects → receives immediately:
{ type: 'session.snapshot', sequence: 41, revision: 3, configuration: {...}, implementation: { operationId: 'op_9', revision: 2, state: 'failed' } }
// then events with sequence > 41
```

The same data is available over HTTP for refresh safety:

```http
GET /session/ABC123/state   →  { revision, configuration, implementation, state }
```

## 3.9 Session lifecycle

```text
CREATED → WAITING_FOR_CLI → CLI_CONNECTED → WAITING_FOR_BROWSER → ACTIVE
        → IMPLEMENTING → COMPLETED → DESTROYED
```

plus `EXPIRED`, `CANCELLED`, `FAILED`, `DISCONNECTED`.

- **CLI disconnects, browser open** → session stays `ACTIVE`; browser shows
  "reconnecting to node"; the CLI resumes and the state snapshot reconciles.
- **Browser disconnects, CLI running** → implementation continues (the node is
  the source of truth); the browser rejoins later and gets the snapshot.
- **Expiry** → HTTP/WS close with a typed reason; the UI renders "session
  expired, run `deployer start` again".

## 3.10 Capabilities — not a generic tunnel

The relay routes **only** the messages above. There is no shell, no arbitrary
TCP forwarding, no filesystem API. Commands are an explicit, closed set; a message
outside it is rejected by the protocol schema on both ends.

## 3.11 Static UI, build-on-demand, GC

- UI builds are **immutable** static assets at `configurator/<version>/`, served
  by CDN/object storage under a wildcard hostname (`v34-1.config.example.com`).
- **Release metadata is permanent; the built artifact is a cache.** If the
  artifact is missing when a session asks for that version, the relay triggers a
  **reproducible rebuild from the recorded commit** and reports
  `session.state = preparing` until ready — the browser renders "Preparing
  configurator…".
- **Build deduplication** is mandatory: N requests for one missing version cause
  **one** build. Use a distributed lock with `ABSENT → BUILDING → READY`, and let
  waiters subscribe to the same job state.
- Old artifacts are garbage-collected after a configurable idle period; the
  registry keeps the metadata so any version can be rebuilt on demand.
- Assets are content-hashed and shared across versions via manifests.

## 3.12 Threat model → mitigation

| Threat | Mitigation |
|---|---|
| session hijacking | separate CLI/browser credentials; pairing secret never in a query string; short TTL |
| session-ID guessing | high-entropy IDs **plus** credentials; rate-limited pairing |
| replay | `commandId` dedupe, monotonic `sequence`, session-scoped credentials |
| tampering | TLS everywhere; Zod validation at both ends; relay validates shape |
| unauthorized commands | closed capability set; relay routes, never executes |
| CLI impersonation | tunnel credential authenticates the CLI to the relay |
| cross-version confusion | explicit protocol version + relay rejection on mismatch |
| artifact tampering | immutable builds + registry metadata + integrity checks |
| relay compromise | the relay holds no long-lived platform credential and cannot reach the platform API |
