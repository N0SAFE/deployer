import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

import { Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EgressPolicy, SafeHttp, type EgressPolicy as Policy, type SafeHttpOptions } from "./safe-http";

const hits: string[] = [];
let server: Bun.Server<undefined>;
let other: Bun.Server<undefined>;
let base: string;
let otherBase: string;

beforeAll(() => {
  other = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) => new Response(req.headers.get("authorization") ?? "none"),
  });
  otherBase = `http://127.0.0.1:${String(other.port)}`;

  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      hits.push(`${req.method} ${path}`);
      switch (path) {
        case "/ok":
          return new Response("hello", { headers: { "content-type": "text/plain" } });
        case "/big":
          return new Response("x".repeat(50_000));
        case "/slow":
          return new Promise<Response>(() => undefined); // never answers
        case "/host":
          return new Response(req.headers.get("host") ?? "");
        case "/to-metadata":
          return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } });
        case "/to-ok":
          return new Response(null, { status: 302, headers: { location: "/ok" } });
        case "/loop":
          return new Response(null, { status: 302, headers: { location: "/loop" } });
        case "/to-file":
          return new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } });
        case "/cross":
          return new Response(null, { status: 302, headers: { location: `${otherBase}/echo-auth` } });
        case "/echo-auth":
          return new Response(req.headers.get("authorization") ?? "none");
        default:
          return new Response("nope", { status: 404 });
      }
    },
  });
  base = `http://127.0.0.1:${String(server.port)}`;
});

afterAll(async () => {
  await server.stop(true);
  await other.stop(true);
});

const allowLoopback: Policy = { ...EgressPolicy.internal, denyPrivate: false, followRedirects: 3, timeout: "2 seconds" };

const call = (
  url: string,
  policy: Policy,
  extra?: { headers?: Record<string, string>; method?: string },
  options: SafeHttpOptions = {},
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      return yield* (yield* SafeHttp).request({ url, ...extra }, policy);
    }).pipe(Effect.provide(SafeHttp.layerWith(options))),
  );

const tag = <A, E>(exit: Exit.Exit<A, E>): string | undefined => {
  if (!Exit.isFailure(exit)) return undefined;
  const failed = exit.cause.reasons.find((r) => r._tag === "Fail");
  return failed === undefined ? undefined : (failed.error as { _tag?: string })._tag;
};

const text = <E>(exit: Exit.Exit<{ body: Uint8Array }, E>): string | undefined =>
  Exit.isSuccess(exit) ? new TextDecoder().decode(exit.value.body) : undefined;

describe("SafeHttp (live, Bun fetch + Bun.dns)", () => {
  it("fetches when the policy allows private targets", async () => {
    const exit = await call(`${base}/ok`, allowLoopback);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.status).toBe(200);
    expect(text(exit)).toBe("hello");
  });

  it("denies loopback/private literal IPs under the user-supplied policy before any connection", async () => {
    const before = hits.length;
    expect(tag(await call(`${base}/ok`, EgressPolicy.userSupplied))).toBe("EgressDenied");
    expect(tag(await call("http://10.1.2.3/x", EgressPolicy.userSupplied))).toBe("EgressDenied");
    expect(tag(await call("http://[::1]:1/x", EgressPolicy.userSupplied))).toBe("EgressDenied");
    expect(tag(await call("http://[::ffff:127.0.0.1]:1/x", EgressPolicy.userSupplied))).toBe("EgressDenied");
    expect(hits.length).toBe(before);
  });

  it("denies a hostname that resolves to loopback (real Bun.dns resolution of `localhost`)", async () => {
    const port = new URL(base).port;
    expect(tag(await call(`http://localhost:${port}/ok`, EgressPolicy.userSupplied))).toBe("EgressDenied");
  });

  it("denies when ANY resolved address is private (mixed answers cannot smuggle one through)", async () => {
    const before = hits.length;
    const mixed = { resolve: () => Promise.resolve([{ address: "93.184.216.34" }, { address: "10.0.0.7" }]) };
    expect(tag(await call("http://app.example.test/x", EgressPolicy.userSupplied, undefined, mixed))).toBe("EgressDenied");
    const metadata = { resolve: () => Promise.resolve([{ address: "169.254.169.254" }]) };
    expect(tag(await call("http://innocent.example.test/", allowLoopback, undefined, metadata))).toBe("EgressDenied");
    expect(hits.length).toBe(before);
  });

  it("connects to the validated address and sends the original authority as Host", async () => {
    const port = new URL(base).port;
    const pinned = { resolve: () => Promise.resolve([{ address: "127.0.0.1" }]) };
    const exit = await call(`http://app.example.test:${port}/host`, allowLoopback, undefined, pinned);
    expect(text(exit)).toBe(`app.example.test:${port}`);
  });

  it("resolves exactly once per hop (the connection cannot be re-pointed after validation)", async () => {
    let lookups = 0;
    const port = new URL(base).port;
    const counting = {
      resolve: () => {
        lookups++;
        return Promise.resolve([{ address: "127.0.0.1" }]);
      },
    };
    await call(`http://app.example.test:${port}/ok`, allowLoopback, undefined, counting);
    expect(lookups).toBe(1);
  });

  it("always denies cloud metadata addresses, even when private ranges are allowed", async () => {
    expect(tag(await call("http://169.254.169.254/latest/meta-data/", allowLoopback))).toBe("EgressDenied");
    expect(tag(await call("http://[fd00:ec2::254]/", allowLoopback))).toBe("EgressDenied");
  });

  it("re-validates every redirect hop (redirect to metadata is refused)", async () => {
    expect(tag(await call(`${base}/to-metadata`, allowLoopback))).toBe("EgressDenied");
  });

  it("follows allowed redirects and reports the final URL", async () => {
    const exit = await call(`${base}/to-ok`, allowLoopback);
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) expect(exit.value.url).toBe(`${base}/ok`);
  });

  it("refuses to follow when redirects are disabled and when they loop", async () => {
    expect(tag(await call(`${base}/to-ok`, { ...allowLoopback, followRedirects: 0 }))).toBe("TooManyRedirects");
    expect(tag(await call(`${base}/loop`, allowLoopback))).toBe("TooManyRedirects");
  });

  it("refuses a redirect to a non-http scheme", async () => {
    expect(tag(await call(`${base}/to-file`, allowLoopback))).toBe("EgressDenied");
  });

  it("rejects disallowed schemes, credentials in the URL and unparseable URLs", async () => {
    expect(tag(await call("ftp://example.com/x", allowLoopback))).toBe("EgressDenied");
    expect(tag(await call("file:///etc/passwd", allowLoopback))).toBe("EgressDenied");
    expect(tag(await call(`http://user:pw@127.0.0.1:${new URL(base).port}/ok`, allowLoopback))).toBe("EgressDenied");
    expect(tag(await call("not a url", allowLoopback))).toBe("EgressDenied");
  });

  it("enforces the host allow-list", async () => {
    const policy: Policy = { ...allowLoopback, allowHosts: ["api.example.com", "*.github.com"] };
    expect(tag(await call(`${base}/ok`, policy))).toBe("EgressDenied");
  });

  it("caps the response size", async () => {
    expect(tag(await call(`${base}/big`, { ...allowLoopback, maxBytes: 1000 }))).toBe("ResponseTooLarge");
  });

  it("times out a server that never answers", async () => {
    expect(tag(await call(`${base}/slow`, { ...allowLoopback, timeout: "300 millis" }))).toBe("HttpTimeout");
  });

  it("reports a refused connection as HttpFailed", async () => {
    expect(tag(await call("http://127.0.0.1:1/x", { ...allowLoopback, timeout: "2 seconds" }))).toBe("HttpFailed");
  });

  it("keeps the Authorization header on same-origin requests", async () => {
    const exit = await call(`${base}/echo-auth`, allowLoopback, { headers: { authorization: "Bearer t0k3n" } });
    expect(text(exit)).toBe("Bearer t0k3n");
  });

  it("drops the Authorization header when a redirect crosses origins", async () => {
    const exit = await call(`${base}/cross`, allowLoopback, { headers: { authorization: "Bearer t0k3n" } });
    expect(text(exit)).toBe("none");
  });
});

describe.skipIf(Bun.which("openssl") === null)("SafeHttp over TLS: pinned IP, original name verified", () => {
  let dir = "";
  let tlsServer: Bun.Server<undefined>;
  let caPem = "";
  let wrongCaPem = "";
  let port = 0;

  const generate = async (name: string, san: string): Promise<{ cert: string; key: string }> => {
    const proc = Bun.spawn(
      [
        "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1",
        "-subj", `/CN=${name}`, "-addext", `subjectAltName=DNS:${san}`,
        "-keyout", `${dir}/${name}.key`, "-out", `${dir}/${name}.crt`,
      ],
      { stdout: "ignore", stderr: "ignore" },
    );
    expect(await proc.exited).toBe(0);
    return { cert: await Bun.file(`${dir}/${name}.crt`).text(), key: await Bun.file(`${dir}/${name}.key`).text() };
  };

  beforeAll(async () => {
    dir = await mkdtemp(`${tmpdir()}/safehttp-tls-`);
    const good = await generate("api.example.test", "api.example.test");
    const other = await generate("other.example.test", "other.example.test");
    caPem = good.cert;
    wrongCaPem = other.cert;
    tlsServer = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { cert: good.cert, key: good.key },
      fetch: (req) => new Response(`tls-ok host=${req.headers.get("host") ?? ""}`),
    });
    port = tlsServer.port ?? 0;
  });

  afterAll(async () => {
    await tlsServer.stop(true);
    await rm(dir, { recursive: true, force: true });
  });

  const resolver = { resolve: () => Promise.resolve([{ address: "127.0.0.1" }]) };

  it("connects to the pinned IP while verifying the certificate for the ORIGINAL hostname", async () => {
    const exit = await call(`https://api.example.test:${String(port)}/`, allowLoopback, undefined, { ...resolver, ca: caPem });
    expect(text(exit)).toBe(`tls-ok host=api.example.test:${String(port)}`);
  });

  it("refuses a certificate that is not valid for the requested name (not merely for the IP)", async () => {
    const exit = await call(`https://api.example.test:${String(port)}/`, allowLoopback, undefined, { ...resolver, ca: wrongCaPem });
    expect(tag(exit)).toBe("HttpFailed");
  });

  it("refuses an untrusted certificate when no CA is supplied", async () => {
    const exit = await call(`https://api.example.test:${String(port)}/`, allowLoopback, undefined, resolver);
    expect(tag(exit)).toBe("HttpFailed");
  });
});

describe("SafeHttp.fake", () => {
  it("serves canned responses, records calls and still applies the egress policy", async () => {
    const { layer, calls } = SafeHttp.fake(() => ({
      status: 200,
      headers: {},
      body: new TextEncoder().encode("ok"),
      url: "https://hooks.example.com/x",
    }));
    const program = Effect.gen(function* () {
      const http = yield* SafeHttp;
      const ok = yield* http.request({ url: "https://hooks.example.com/x" }, EgressPolicy.userSupplied);
      const denied = yield* Effect.flip(http.request({ url: "http://169.254.169.254/" }, EgressPolicy.userSupplied));
      return { ok, denied };
    }).pipe(Effect.provide(layer));
    const { ok, denied } = await Effect.runPromise(program);
    expect(ok.status).toBe(200);
    expect(denied._tag).toBe("EgressDenied");
    expect(calls.map((c) => c.url)).toEqual(["https://hooks.example.com/x", "http://169.254.169.254/"]);
  });
});

describe("EgressPolicy.operatorTarget and denyClasses", () => {
  const operator: Policy = { ...EgressPolicy.operatorTarget, timeout: "500 millis" };
  const never = { resolve: () => Promise.reject(new Error("must not resolve")) };

  it("refuses loopback, link-local, unspecified, multicast and reserved literals before any connection", async () => {
    const before = hits.length;
    for (const url of [`${base}/ok`, "http://[::1]:1/", "http://169.254.10.10/", "http://0.0.0.0/", "http://224.0.0.1/", "http://240.0.0.1/"]) {
      expect(tag(await call(url, operator, undefined, never)), url).toBe("EgressDenied");
    }
    expect(hits.length).toBe(before);
  });

  it("accepts private LAN addresses (a home-lab peer is a normal target): the policy passes, the connection decides", async () => {
    const exit = await call("http://10.255.255.1:9/", operator);
    expect(tag(exit)).not.toBe("EgressDenied");
    expect(["HttpTimeout", "HttpFailed"]).toContain(tag(exit));
  });

  it("accepts CGNAT/overlay addresses (Tailscale-style 100.64/10)", async () => {
    expect(tag(await call("http://100.100.1.1:9/", operator))).not.toBe("EgressDenied");
  });

  it("a hostname that resolves to a private address is accepted, to loopback or metadata it is refused", async () => {
    const lan = { resolve: () => Promise.resolve([{ address: "10.255.255.2" }]) };
    expect(tag(await call("http://peer.lan.test:9/", operator, undefined, lan))).not.toBe("EgressDenied");
    const loop = { resolve: () => Promise.resolve([{ address: "127.0.0.1" }]) };
    expect(tag(await call("http://peer.lan.test:9/", operator, undefined, loop))).toBe("EgressDenied");
    const meta = { resolve: () => Promise.resolve([{ address: "169.254.169.254" }]) };
    expect(tag(await call("http://peer.lan.test/", operator, undefined, meta))).toBe("EgressDenied");
  });

  it("refuses cloud metadata addresses under every policy, including one that allows everything else", async () => {
    const permissive: Policy = { ...EgressPolicy.operatorTarget, denyClasses: [], timeout: "500 millis" };
    expect(tag(await call("http://169.254.169.254/latest/meta-data/", permissive))).toBe("EgressDenied");
    expect(tag(await call("http://100.100.100.200/", permissive))).toBe("EgressDenied");
  });

  it("denyClasses replaces denyPrivate: an empty list allows loopback even if denyPrivate is true", async () => {
    const policy: Policy = { ...allowLoopback, denyPrivate: true, denyClasses: [], denyMetadata: true };
    expect(text(await call(`${base}/ok`, policy))).toBe("hello");
  });

  it("does not follow redirects", async () => {
    const policy: Policy = { ...allowLoopback, denyClasses: [], followRedirects: 0 };
    expect(tag(await call(`${base}/to-ok`, policy))).toBe("TooManyRedirects");
  });

  it("the shipped preset has the intended shape", () => {
    expect(EgressPolicy.operatorTarget.followRedirects).toBe(0);
    expect(EgressPolicy.operatorTarget.denyMetadata).toBe(true);
    expect(EgressPolicy.operatorTarget.denyClasses).toEqual(["loopback", "link-local", "unspecified", "multicast", "reserved"]);
  });
});
