# Realtime reads: SSE siblings instead of client polling

Any endpoint that a screen needs **live** gets a `…/stream` sibling next to the
plain query. Same input, same payload — the difference is who does the work:

| | plain endpoint | `…/stream` sibling |
|---|---|---|
| Transport | GET → one JSON body | GET → text/event-stream |
| Who re-evaluates | every open tab, on `refetchInterval` | the server, once per stream |
| When data reaches the client | every tick, changed or not | only when the payload differs |
| Cost per idle tab | a query every N seconds | one open connection, zero queries |

## The server side: `liveSnapshot()`

`apps/api/shared/src/core/utils/live-snapshot.utils.ts`

```ts
return liveSnapshot(() => this.analytics.realtimeMetrics(readServices(input)), {
  intervalMs: 10_000, // the interval the client used to poll at
});
```

- emits the first snapshot immediately;
- re-evaluates on `intervalMs`, **cancelling** an in-flight evaluation
  (`switchMap`) so a slow query degrades to "as fast as it completes" instead of
  queueing;
- suppresses unchanged payloads (`distinctUntilChanged`, JSON equality);
- drops a failed evaluation and retries on the next tick — the last good snapshot
  stays on screen instead of the stream dying;
- stops the moment the last subscriber disconnects.

`intervalMs` is a **sample** cadence, not a client poll: it exists because a
metrics rollup has no domain event to hang an update off. For data that does emit
events, subscribe to them instead and use the interval as a fallback (the docker
`inspect` stream merges `observeEvents()` with an interval trigger for exactly
this reason).

## The contract side

```ts
export const analyticsStreamRealTimeMetricsContract = analyticsRealtimeMetricsOps
    .list()
    .path("/metrics/realtime/stream")
    .input((input) => input.query(analyticsServiceHealthQuerySchema))
    .output((output) => output.observable(analyticsRealtimeMetricsOutputSchema))
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build();
```

Register it in the same router as the query, then regenerate the BFF delegation:

```bash
python3 scripts/gen-bff-delegation.py
```

## The client side

```ts
useQuery(
  analyticsEndpoints.getRealTimeMetricsStream.experimental_liveObservableOptions({
    input: { query: { services } },
  }),
)
```

No `refetchInterval`. The transport reconnects and replays by sequence number, so
a dropped connection resumes without a full refetch.

## Converted so far

| Query | Interval it used to poll at | Stream |
|---|---|---|
| `analytics.getRealTimeMetrics` | 10 s | `getRealTimeMetricsStream` |
| `analytics.getServiceHealth` | 15 s | `getServiceHealthStream` |
| `analytics.getResourceMetrics` | 30 s | `getResourceMetricsStream` |
| `analytics.getResourceUsage` | 30 s | `getResourceUsageStream` |
| `analytics.getDeploymentMetrics` | 60 s | `getDeploymentMetricsStream` |
| `analytics.getDeploymentUsage` | 60 s | `getDeploymentUsageStream` |
| `cluster.getSwarmConfig` | 15 s | `streamSwarmConfig` |
| `setup.getPostSetupVerification` | 2 s | `getPostSetupVerificationStream` |

Still client-driven after this pass: the deployment logs viewer
(`deployment-logs-viewer.tsx`, 4 s `refetch`) — it should move onto the existing
deployment stream — and pure UI clocks (`use-now.ts`, `relative-time.tsx`), which
are not data polling.
