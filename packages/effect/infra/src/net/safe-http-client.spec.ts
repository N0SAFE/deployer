import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EgressPolicy, EgressDenied, HttpTimeout, ResponseTooLarge, TooManyRedirects, HttpFailed, type EgressPolicy as Policy } from "./safe-http";
import { makeSafeHttpClient, publicEgressMessage } from "./safe-http-client";

let server: Bun.Server<undefined>;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/json") return Response.json({ advertisedHost: "node-a.lan", version: "1.2.3" });
      if (path === "/cookies") {
        const headers = new Headers();
        headers.append("set-cookie", "a=1; Path=/");
        headers.append("set-cookie", "session_token=tok; Path=/; HttpOnly");
        return new Response("{}", { headers });
      }
      if (path === "/big") return new Response("x".repeat(10_000));
      return new Response("nope", { status: 404 });
    },
  });
  base = `http://127.0.0.1:${String(server.port)}`;
});

afterAll(async () => {
  await server.stop(true);
});

const local: Policy = { ...EgressPolicy.internal, denyPrivate: false, denyClasses: [], timeout: "2 seconds" };

describe("makeSafeHttpClient (the Promise edge of SafeHttp)", () => {
  it("resolves with the response", async () => {
    const res = await makeSafeHttpClient().request({ url: `${base}/json` }, local);
    expect(res.status).toBe(200);
    expect(JSON.parse(new TextDecoder().decode(res.body))).toEqual({ advertisedHost: "node-a.lan", version: "1.2.3" });
  });

  it("keeps every Set-Cookie, joined the way Headers.get joins them", async () => {
    const res = await makeSafeHttpClient().request({ url: `${base}/cookies` }, local);
    expect(res.headers["set-cookie"]).toBe("a=1; Path=/, session_token=tok; Path=/; HttpOnly");
  });

  it("throws the tagged error so callers can instanceof it", async () => {
    const client = makeSafeHttpClient();
    await expect(client.request({ url: "http://169.254.169.254/" }, local)).rejects.toBeInstanceOf(EgressDenied);
    await expect(client.request({ url: `${base}/big` }, { ...local, maxBytes: 100 })).rejects.toBeInstanceOf(ResponseTooLarge);
    await expect(client.request({ url: "http://127.0.0.1:1/" }, local)).rejects.toBeInstanceOf(HttpFailed);
  });

  it("uses the injected resolver", async () => {
    const client = makeSafeHttpClient({ resolve: () => Promise.resolve([{ address: "127.0.0.1" }]) });
    const res = await client.request({ url: `http://svc.internal.test:${String(server.port)}/json` }, local);
    expect(res.status).toBe(200);
  });
});

describe("publicEgressMessage", () => {
  it("returns a category, never the raw transport detail or the address a name resolved to", () => {
    expect(publicEgressMessage(new EgressDenied({ url: "http://x", reason: "private address 10.0.0.5" }))).toBe("Target not allowed by the network policy");
    expect(publicEgressMessage(new HttpTimeout({ url: "http://x", afterMs: 5 }))).toBe("Timed out");
    expect(publicEgressMessage(new TooManyRedirects({ url: "http://x", limit: 0 }))).toBe("Redirect not followed");
    expect(publicEgressMessage(new ResponseTooLarge({ url: "http://x", limitBytes: 1 }))).toBe("Response too large");
    expect(publicEgressMessage(new HttpFailed({ url: "http://x", message: "ECONNREFUSED 10.0.0.5:5432" }))).toBe("Connection failed");
    const unknown = publicEgressMessage(new Error("ECONNREFUSED 10.0.0.5:5432"));
    expect(unknown).toBe("Connection failed");
    expect(unknown).not.toContain("10.0.0.5");
  });
});
