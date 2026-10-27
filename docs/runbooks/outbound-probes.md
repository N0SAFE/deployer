# Runbook — outbound probes and the egress policy (NET-004, SEC-013)

## What was wrong

Reachability checks, domain checks, the post-deploy probe and the setup wizard's mesh sign-in called `fetch` on URLs a user (or an unauthenticated visitor, for the setup wizard) typed. Any of them could be pointed at `127.0.0.1`, the docker network, `169.254.169.254` or a LAN host, and some echoed the transport error back (an internal port scanner). The setup sign-in also POSTed the admin credentials to the typed URL.

## What changed

All of these go through `EgressService` (`apps/api/shared/src/core/modules/egress`), the Nest face of `SafeHttp` (`@deployer/effect-infra`): the name is resolved once, **every** answer is checked, the connection goes to the checked address, redirects are re-checked per hop (or refused), and size and time are capped.

| Target kind | Used by | Refused |
|---|---|---|
| `external` (user-supplied domain or public address) | domain check, `verifyPublicAddress`, post-deploy probe | metadata, loopback, link-local, private ranges (production default), unspecified/multicast/reserved; max 3 redirects |
| `operator` (peer or node address an operator typed) | `reachability.check`, node public-URL probe, mesh peer probe, setup `remoteAuth` | metadata, loopback, link-local, unspecified/multicast/reserved; **LAN ranges allowed**; no redirects |
| `fixedExternal` (hosts the platform chose) | public-IP echo, DNS-over-HTTPS | everything but the listed hosts, https only |

Callers get a category (`Target not allowed by the network policy`, `Timed out`, `Connection failed`, ...); the resolved address and the transport error go to the server log only.

## Configuration

`DEPLOYER_ALLOW_PRIVATE_PROBES`

- Unset: **false in production, true elsewhere** (so `*.localhost` domains work in development).
- `true` in production: user-supplied domains may resolve to private ranges (LAN-only domains). Loopback, link-local and metadata stay refused.
- `false` outside production: apply the production policy locally.

The policy that was resolved is logged once at boot (`Egress policy: external=... operator=...`).

## Operating notes

- A domain that resolves to a private address and now shows "not reachable": set the flag to `true` if that is intended, otherwise fix the DNS record.
- A mesh peer on `127.0.0.1` is refused in production by design; use its LAN or mesh address.
- `probeAddress` / `probePeer` (`@deployer/nest-reachability`) require an injected `http`. Pass `egress.probeHttp("external" | "operator")`; there is deliberately no default.

## Known limits

- The role-gate on `reachability.check` is `NET-003`; any authenticated user can still call it (now safely).
- The mesh range `100.88.0.0/16` is treated like any private range for operator targets.
- Internal call sites (swarm route verifier, docker health check, ownership resolver, platform health, mesh peer wrappers) are not migrated yet.
- The frozen monolith (`apps/api`) still calls the probes without `http` and does not compile against the package; it goes away with the cutover.
