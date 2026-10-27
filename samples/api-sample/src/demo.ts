import assert from "node:assert/strict";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { isDefinedError, safe } from "@orpc/client";
import { firstValueFrom, toArray } from "rxjs";
import { createApp } from "./server";
import { createClient } from "./client";
import { startTelemetry } from "./telemetry";

/**
 * End-to-end walkthrough. Boots the Nest app in-process, signs a real Better
 * Auth user up, then exercises every integration through the public HTTP
 * surface. `bun run demo` is the runnable check for this sample.
 */

const spans = new InMemorySpanExporter();
const telemetry = startTelemetry(spans);
const app = await createApp();

await app.listen(3210, "127.0.0.1");
const url = "http://127.0.0.1:3210";

const ok = (label: string, value?: unknown) =>
  console.log(`✓ ${label}`, value === undefined ? "" : value);

try {
  // ── Better Auth ────────────────────────────────────────────────────────────
  const email = `demo-${Date.now()}@example.com`;
  const signUp = await fetch(`${url}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "password1234", name: "Demo User" }),
  });

  assert.ok(signUp.ok, `sign-up failed: ${signUp.status} ${await signUp.text()}`);

  const cookie = signUp.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie, "Better Auth did not set a session cookie");

  ok("Better Auth sign-up, session cookie issued");

  const client = createClient({ url, cookie });

  // ── OpenAPI link + contract validation ────────────────────────────────────
  const planets = await client.planet.list({ limit: 2 });
  assert.equal(planets.length, 2);
  ok("OpenAPILink list (defaults + query coercion)", `${planets.length} planets`);

  const created = await client.planet.create({
    name: "Pluto",
    description: "Still a planet in this sample",
  });
  assert.equal(created.name, "Pluto");
  ok("Protected procedure with forwarded cookie", created.id);

  // ── Typed CONFLICT from the domain error ──────────────────────────────────
  const [conflict] = await safe(client.planet.create({ name: "Pluto" }));
  assert.ok(isDefinedError(conflict), "expected a defined CONFLICT error");
  assert.equal(conflict.code, "CONFLICT");
  assert.deepEqual(conflict.data, { name: "Pluto" });
  ok("Typed CONFLICT error", conflict.code);

  // ── Typed error (contract-first) ──────────────────────────────────────────
  const [missing, data] = await safe(client.planet.findById({ id: "nope" }));
  assert.equal(data, undefined);
  assert.ok(isDefinedError(missing), "expected a defined NOT_FOUND error");
  assert.equal(missing.code, "NOT_FOUND");
  assert.deepEqual(missing.data, { id: "nope" });
  ok("Typed NOT_FOUND error", missing.code);

  // ── Auth guard ────────────────────────────────────────────────────────────
  const anonymous = createClient({ url });
  const [unauthorized] = await safe(anonymous.auth.me());
  assert.ok(isDefinedError(unauthorized), "expected a defined UNAUTHORIZED error");
  assert.equal(unauthorized.code, "UNAUTHORIZED");
  assert.deepEqual(unauthorized.data, { reason: "missing-session" });
  ok("Typed UNAUTHORIZED error", unauthorized.code);

  // Public procedure still sees the middleware-resolved session.
  const anonymousWhoami = await anonymous.auth.whoami();
  assert.equal(anonymousWhoami.authenticated, false);
  assert.equal(anonymousWhoami.email, null);
  ok("Optional auth (anonymous)", anonymousWhoami.authenticated);

  const me = await client.auth.me();
  assert.equal(me.email, email);
  ok("Session in oRPC context", me.email);

  const whoami = await client.auth.whoami();
  assert.equal(whoami.authenticated, true);
  assert.equal(whoami.email, email);
  ok("Optional auth (session resolved by middleware)", whoami.email);

  // ── SSE streaming (RxJS Observable end to end) ───────────────────────────
  const events = await firstValueFrom(client.logs.stream({ count: 3 }).pipe(toArray()));
  assert.deepEqual(
    events.map((event) => event.message),
    ["tick 1/3", "tick 2/3", "tick 3/3"],
  );
  ok("SSE stream (Observable)", `${events.length} events`);

  // ── Effect client loopback + OpenTelemetry propagation ───────────────────
  const report = await client.demo.report({ missingId: "lost-planet" });
  assert.ok(report.total >= 5);
  assert.equal(report.recovered, "unknown:lost-planet");
  assert.ok(report.traceId, "no active trace id");
  ok("Effect client loopback", report.recovered);

  const finished = spans.getFinishedSpans();
  assert.ok(finished.length > 0, "OpenTelemetry captured no spans");

  const sameTrace = finished.filter((span) => span.spanContext().traceId === report.traceId);
  assert.ok(
    sameTrace.length >= 2,
    `expected nested spans in one trace, got ${sameTrace.length}`,
  );
  ok(
    "OpenTelemetry spans",
    `${finished.length} total, ${sameTrace.length} in trace ${report.traceId}`,
  );

  // ── Contract → OpenAPI ────────────────────────────────────────────────────
  const document = (await fetch(`${url}/openapi.json`).then((response) =>
    response.json(),
  )) as { paths: Record<string, { get?: unknown }> };
  assert.ok(document.paths["/logs/stream"].get);
  ok("Generated OpenAPI document", `${Object.keys(document.paths).length} paths`);

  console.log("\nAll integrations verified.");
} finally {
  await app.close();
  await telemetry.shutdown();
}
