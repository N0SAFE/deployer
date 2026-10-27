import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OwnershipResolverService, type OwnershipChange } from "./ownership-resolver.service";

const jsonResponse = (body: unknown, ok = true) => ({ ok, json: () => Promise.resolve(body) }) as Response;

describe("OwnershipResolverService", () => {
  const fetchMock = vi.fn();
  let resolver: OwnershipResolverService;

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    resolver = new OwnershipResolverService();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves to no owners when no node is registered", async () => {
    await expect(resolver.resolveOwners("deployments")).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks each registered node, for the entity, on its own base url", async () => {
    resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
    resolver.registerNode({ id: "node-b", baseUrl: "http://node-b:3002" });
    fetchMock.mockResolvedValue(jsonResponse({}));

    await resolver.resolveOwners("deployments");

    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([
      "http://node-a:3001/ownership?entity=deployments",
      "http://node-b:3002/ownership?entity=deployments",
    ]);
  });

  it("lists a node that answers with an ownership payload", async () => {
    resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
    fetchMock.mockResolvedValue(jsonResponse({ owns: true }));

    await expect(resolver.resolveOwners("deployments")).resolves.toEqual(["node-a"]);
  });

  it("skips a node that answers with an error status", async () => {
    resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
    resolver.registerNode({ id: "node-b", baseUrl: "http://node-b:3002" });
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false)).mockResolvedValueOnce(jsonResponse({ owns: true }));

    await expect(resolver.resolveOwners("deployments")).resolves.toEqual(["node-b"]);
  });

  it("skips a node it cannot reach and still asks the others", async () => {
    resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
    resolver.registerNode({ id: "node-b", baseUrl: "http://node-b:3002" });
    fetchMock.mockRejectedValueOnce(new Error("getaddrinfo EAI_AGAIN")).mockResolvedValueOnce(jsonResponse({}));

    await expect(resolver.resolveOwners("deployments")).resolves.toEqual(["node-b"]);
  });

  it("does not list a node whose body is not an object", async () => {
    resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
    fetchMock.mockResolvedValue(jsonResponse("nope"));

    await expect(resolver.resolveOwners("deployments")).resolves.toEqual([]);
  });

  it("publishes each resolution on watchOwnership", async () => {
    resolver.registerNode({ id: "node-a", baseUrl: "http://node-a:3001" });
    fetchMock.mockResolvedValue(jsonResponse({}));
    const changes: OwnershipChange[] = [];
    const sub = resolver.watchOwnership("deployments").subscribe((change) => changes.push(change));

    await resolver.resolveOwners("deployments");
    sub.unsubscribe();

    expect(changes).toEqual([{ resourceKey: "deployments", owners: ["node-a"] }]);
  });

  // A node that replies `{ owns: false }` is currently listed as an owner, because the payload
  // guard accepts any object and never reads `owns`. Pinned as a todo until the intended
  // contract of the `/ownership` answer is decided; asserting today's behaviour would enshrine it.
  it.todo("does not list a node that answers { owns: false }");
});
