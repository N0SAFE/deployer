# @deployer/effect-reachability

Probing questions about an address: is something alive there, and is it what I expect?

Effect-native, framework-agnostic. No `@nestjs` import anywhere in this package, no
transport code either.

## What it does NOT do

This package adds *only* the probing semantics — which urls to ask, in what order, and
how to read an answer. Everything else is reused:

| Concern | Comes from |
|---|---|
| Address parsing, origin, IP literal detection | `@deployer/effect-infra` (`hostOf`, `toOrigin`, `isIpAddress`) |
| IP classification, SSRF policy | `@deployer/effect-infra` (`classifyAddress`, `EgressPolicy`) |
| Timeouts, redirect limits, size caps, DNS pinning, TLS | `@deployer/effect-infra` (`SafeHttp`) |
| Latency measurement | `performance.now()` (Web API) |
| JSON decoding of a peer's identity | `Schema.decodeUnknownOption` (effect) |
| "try in order, keep the first success" | `Effect.firstSuccessOf` (effect) |
| Parallel probe variants | `Effect.forEach(..., { concurrency })` (effect) |

The caller supplies the `EgressPolicy`: what a probe may reach is the app's rule.

## API

```ts
import { Effect } from "effect";
import { EgressPolicy } from "@deployer/effect-infra";
import { probeAddress, probePeer } from "@deployer/effect-reachability";

const valid = yield* probeAddress("node.example.com", {
  policy: EgressPolicy.userSupplied,
  paths: ["/mesh/ping", "/health"],
  tryBothSchemes: true,
});

const peer = yield* probePeer("https://10.0.0.5:3005", {
  policy: EgressPolicy.operatorTarget,
  primaryPath: "/mesh/ping",
  fallbackPath: "/health",
});
```

Neither function fails: "not reachable" is a result, and every `SafeHttp` refusal is a
reason the caller reports. Failure reasons never carry a resolved address, so a probe
endpoint cannot be turned into a port scanner.

## Testing

`SafeHttp.fake(handler)` from `@deployer/effect-infra` is the test double — it applies the
real scheme/host/IP policy and records calls without touching a socket.

> One gotcha, documented in `vitest.config.mts`: the isolated linker gives each workspace
> its own `node_modules`, so `effect` must be aliased to a single copy in tests. Two copies
> of the runtime mean two `Layer`/`Context` classes, and a layer built by one cannot be
> provided to an effect from the other.
