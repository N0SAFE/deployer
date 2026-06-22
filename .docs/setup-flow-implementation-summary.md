# Setup Flow Implementation Summary

> **Date**: 2026-06-06

## Architecture

```
┌─────────────┐     ORPC Contract      ┌──────────────────────┐
│  Web UI     │ ◄──────────────────►   │  SetupController     │
│  (/setup)   │     (SSE stream)       │  (publicAccess)      │
└──────┬──────┘                        └──────────┬───────────┘
       │                                          │
       │                                          ▼
       │                              ┌──────────────────────┐
       │                              │ InitializationService│
       │                              │  - getSetupState()   │
       │                              │  - getStateMachine() │
       │                              │  - getNodeStatus()   │
       │                              │  - initialize()      │
       │                              └──────┬───────────────┘
       │                                     │
       │              ┌──────────────────────┼──────────────┐
       │              ▼                      ▼              ▼
       │   ┌──────────────────┐  ┌──────────────────┐  ┌──────────┐
       │   │ LocalInitService │  │ RemoteInitService│  │  Node    │
       │   │ - provision DB   │  │ - mesh handshake │  │  Config  │
       │   │ - run migrations │  │ - register node  │  │  Repo    │
       │   │ - seed data      │  │                  │  │ (SQLite) │
       │   └──────────────────┘  └──────────────────┘  └──────────┘
       │
       ▼
┌──────────────┐
│ GlobalModule │  (waits for setup completion before creating PG pool)
└──────────────┘
```

## Module Startup Ordering (Gatekeeper Pattern)

1. `GlobalModule`'s `useFactory` for `GLOBAL_DATABASE_POOL` calls `InitializationService.waitForSetup()`
2. `InitializationService.onModuleInit()` checks local SQLite for existing config
   - If config exists: emits completed signal immediately
   - If no config: signal waits until user completes setup wizard
3. When `initialize()` completes → `emitCompleted()` → `ReplaySubject(1)` emits
4. `GlobalModule` receives signal → creates Postgres pool → all dependent modules unblock

## Key Contracts

| Endpoint | Method | Input | Output |
|----------|--------|-------|--------|
| `setup.getState` | Query | `{}` | `SetupStateSnapshot` |
| `setup.getStateMachine` | Query | `{}` | `SetupStateMachine` |
| `setup.getNodeStatus` | Query | `{}` | `NodeConfigStatus` |
| `setup.probeDatabase` | Mutation | `{ databaseUrl }` | `SetupProbeDbResult` |
| `setup.probeMesh` | Mutation | `{ meshUrl }` | `SetupProbeMeshResult` |
| `setup.remoteAuth` | Mutation | `{ meshUrl, username, password }` | `SetupRemoteAuthResult` |
| `setup.initialize` | Mutation | `SetupInitializeInput` | `Observable<SetupStreamEvent>` |

## State Machine

```
States: not_started → awaiting_strategy → awaiting_credentials → provisioning → completed
                                                ↓
                                        awaiting_remote_auth → provisioning → completed

Transitions:
- not_started          → awaiting_strategy     (start_setup)
- awaiting_strategy    → awaiting_credentials  (choose_local)
- awaiting_strategy    → awaiting_remote_auth  (choose_remote)
- awaiting_credentials → provisioning           (start_initialize)
- awaiting_remote_auth → provisioning           (remote_auth_complete)
- provisioning         → completed              (provisioning_complete)

Terminal: completed
Initial: not_started
```

## Mesh Web Endpoints

The mesh contract is at top-level `appContract.mesh`, NOT under `appContract.core.mesh`. 
The web domain endpoints use `orpc.mesh.*` (not `orpc.core.mesh.*`).

## Known Issues Fixed

1. **ReachabilityService**: Previously used external proxies (codetabs, allorigins) with callback/token pattern. Rewritten to direct HTTP `GET {url}/mesh/node/local` with 5s AbortController timeout.
2. **Subject → ReplaySubject**: `InitializationService` changed from `Subject` to `ReplaySubject(1)` to prevent `EmptyError` for late subscribers.
3. **Missing `setupStateMachineSchema`**: Added to contracts-entities with transitions schema.
4. **Controller spec import**: Fixed wrong import path (`../services/setup.service` → `@/core/modules/.../initialization.service`).
5. **Signin page test**: Fixed `useSetupStatus` → `useSetupState` mock.
