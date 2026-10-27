# Deployer Runtime Architecture

> **Status:** canonical target architecture — supersedes
> `docs/setup-lifecycle-complete.md` (setup-as-an-app), `docs/startup-flow-explained.md`
> (orchestrator pipeline) and the deleted `api-bff-orchestrator.md`.
> **Scope:** node lifecycle, CLI onboarding, configurator, api services + BFF,
> networking/DNS, swarm, boot sequences.
> **Branch:** `rewrite-v3`

This series describes what Deployer is becoming. Read them in order; each one is
standalone but assumes the vocabulary of the previous.

| # | Document | Answers |
|---|---|---|
| 01 | [Lifecycle & ownership](./01-lifecycle-and-ownership.md) | What states can a node be in? Who owns which step? |
| 02 | [CLI onboarding](./02-cli-onboarding.md) | `deployer status` / `deployer start`; first-run without a setup server |
| 03 | [Configurator protocol](./03-configurator-protocol.md) | The outbound tunnel, browser UI, commands/events, revisions |
| 04 | [Services & BFF](./04-services-and-bff.md) | The service split, contracts, what the BFF owns |
| 05 | [Service anatomy](./05-service-anatomy.md) | The mandatory NestJS file structure for every app |
| 06 | [Networking & DNS](./06-networking-and-dns.md) | No more `*.deployer.localhost`; dev ports; prod internal DNS + Traefik |
| 07 | [Swarm runtime](./07-swarm-runtime.md) | How the cluster is founded, joined, and how services are placed |
| 08 | [Boot sequences](./08-boot-sequences.md) | End-to-end worked examples with real log output |
| 09 | [Implementation plan](./09-implementation-plan.md) | The exact order of work, what is deleted, and how "done" is verified |
| 10 | [Developer journeys](./10-developer-journeys.md) | plain dev · dev-supervised · local; operator first-run and daily use; how status is shown |
| 11 | [CLI as a client](./11-cli-as-a-client.md) | Local vs client modes, auth, full command surface, `configure`/`config`, exit codes |
| 12 | [Architecture review](./12-architecture-review.md) | Adversarial pass; the contradictions found and fixed; open items |
| 13 | [Readiness & boot gating](./13-readiness-and-preflight.md) | Preflight checks, why the port binds first, who answers "is it healthy?" |

## Executive summary

Three changes define the new architecture:

**1. Setup is not a server.** Today `apps/setup` is a second NestJS app that
serves a wizard, holds a gate that compose waits on, and hands the entry port over
before exiting. That app is deleted. Onboarding becomes a **CLI flow**
(`deployer start` on a node that has never been configured) that talks to a
**configurator** — the versioned browser UI plus a pass-through relay. The
configurator is **not a platform service** (a fresh node has nothing to host it):
the CLI either serves the UI on localhost or opens an outbound tunnel to the
remote relay. Nothing about a first-run install requires a bespoke server whose
only purpose is to exist before the platform does.

**2. The API is one BFF over several domain services.** `apps/api` stops being a
single NestJS application with ~20 product modules wired into one graph. It
becomes:

- `apps/api/bff` — the only public HTTP surface; owns auth/session, SSR, and
  **real front-facing composition** (it aggregates, reshapes, authorises — it is
  not a pass-through proxy);
- `apps/api/services/*` — domain services, **entity-first and CRUD-shaped**,
  each owning its aggregates, its tables, and its business rules;
- `apps/api/shared` — everything shared **inside** the API folder (platform core,
  config, auth, shared server bootstrap). Nothing here leaks into `packages/*`.

**3. No `*.deployer.localhost`.** The naming scheme (`api.deployer.localhost`,
`web.deployer.localhost`, `setup.deployer.localhost`) tied the whole system to a
loopback DNS trick that made every environment look like a special case. It is
removed. **Dev uses ports. Prod uses real internal networking (service-name DNS
on the platform network) plus one operator-chosen public domain** routed through
Traefik. See [06](./06-networking-and-dns.md).

## Non-goals (explicit)

- **No orchestrator app.** An earlier draft of this design made `apps/setup` a
  long-lived supervisor of the API services. That is rejected: supervision is
  what the **swarm** and the **CLI** already do. Adding a third owner of "is the
  platform up?" creates a component whose failure mode is indistinguishable from
  the failure it reports.
- **No in-process RPC bus.** Services are real processes with real boundaries.
- **No compatibility layer.** Old files are deleted as they are replaced
  (`core-rules`: replace, never bridge).
- **No `packages/*` promotion** for API internals. Shared API code lives under
  `apps/api/`.
