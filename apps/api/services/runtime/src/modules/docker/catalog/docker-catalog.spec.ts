import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { CatalogLocalPort, CatalogMeshPort, DockerCatalog } from "./docker-catalog";

const emptyCatalog = { containers: [], images: [], networks: [], volumes: [], registries: [], stacks: [] };
const network = (name: string) => ({
  id: name, name, driver: "bridge", scope: "local", internal: false, attachable: true, subnet: null, gateway: null,
  containerIds: [], labels: {}, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
});
const listInput = { limit: 10, offset: 0, sortBy: "name", sortDirection: "asc", filter: {} } as never;

const run = <A>(effect: Effect.Effect<A, unknown, CatalogMeshPort | CatalogLocalPort>, mesh: unknown, local: unknown) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(CatalogMeshPort, mesh as never),
      Effect.provideService(CatalogLocalPort, local as never),
    ),
  );

describe("DockerCatalog", () => {
  it("falls back to this node's catalog when no peer answers", async () => {
    const local = { getRuntimeCatalogSnapshot: vi.fn().mockResolvedValue({ ...emptyCatalog, networks: [network("b"), network("a")] }) };
    const mesh = { listRuntimeCatalogAcrossInstances: vi.fn().mockResolvedValue({ responses: [] }) };
    const page = await run(DockerCatalog.live.listNetworks(listInput), mesh, local);
    expect(page.data.map((item) => item.name)).toEqual(["a", "b"]);
    expect(page.meta).toMatchObject({ total: 2, hasMore: false });
  });

  it("falls back to this node's catalog when the fan-out fails", async () => {
    const local = { getRuntimeCatalogSnapshot: vi.fn().mockResolvedValue(emptyCatalog) };
    const mesh = { listRuntimeCatalogAcrossInstances: vi.fn().mockRejectedValue(new Error("mesh down")) };
    await expect(run(DockerCatalog.live.resolve(), mesh, local)).resolves.toEqual(emptyCatalog);
    expect(local.getRuntimeCatalogSnapshot).toHaveBeenCalled();
  });

  it("merges the catalogs the peers sent", async () => {
    const mesh = {
      listRuntimeCatalogAcrossInstances: vi.fn().mockResolvedValue({
        responses: [
          { catalog: { ...emptyCatalog, networks: [network("a")] } },
          { catalog: { ...emptyCatalog, networks: [network("b")] } },
        ],
      }),
    };
    const page = await run(DockerCatalog.live.listNetworks(listInput), mesh, { getRuntimeCatalogSnapshot: vi.fn() });
    expect(page.data.map((item) => item.name).sort()).toEqual(["a", "b"]);
  });
});

/** A peer's catalog with one image, one network and one volume named after `imageId`. */
function createRuntimeCatalog(imageId: string) {
  return {
    containers: [],
    images: [
      { id: imageId, registry: "docker.io", repository: "library/alpine", tag: "latest", digest: null, sizeBytes: null, createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-02T00:00:00.000Z", labels: {} },
    ],
    networks: [network(`net-${imageId}`)],
    volumes: [],
    registries: [],
    stacks: [],
  };
}

describe("DockerCatalog images from the mesh", () => {
  it("merges the images of every responding node", async () => {
    const mesh = { listRuntimeCatalogAcrossInstances: vi.fn().mockResolvedValue({ responses: [{ catalog: createRuntimeCatalog("img-1") }, { catalog: createRuntimeCatalog("img-2") }] }) };
    const local = { getRuntimeCatalogSnapshot: vi.fn() };
    const catalog = await run(DockerCatalog.live.resolve(), mesh, local);
    expect(mesh.listRuntimeCatalogAcrossInstances).toHaveBeenCalledWith({}, { timeoutMs: 2_000, maxCollectedResponses: 128 });
    expect(catalog.images.map((image) => image.id).sort()).toEqual(["img-1", "img-2"]);
    expect(local.getRuntimeCatalogSnapshot).not.toHaveBeenCalled();
  });

  it("normalizes placeholder image repositories a peer sent", async () => {
    const withPlaceholder = createRuntimeCatalog("img-valid");
    withPlaceholder.images.push({ id: "img-placeholder", registry: "undefined", repository: "undefined", tag: "latest", digest: null, sizeBytes: null, createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-03T00:00:00.000Z", labels: {} });
    const mesh = { listRuntimeCatalogAcrossInstances: vi.fn().mockResolvedValue({ responses: [{ catalog: withPlaceholder }] }) };
    const catalog = await run(DockerCatalog.live.resolve(), mesh, { getRuntimeCatalogSnapshot: vi.fn() });
    const placeholder = catalog.images.find((image) => image.id === "img-placeholder");
    expect(placeholder?.registry).toBe("local");
    expect(placeholder?.repository).toBe("untagged/img-placehol");
  });

  it("falls back to the local catalog when the mesh call throws", async () => {
    const mesh = { listRuntimeCatalogAcrossInstances: vi.fn(() => { throw new Error("mesh runtime catalog unavailable"); }) };
    const local = { getRuntimeCatalogSnapshot: vi.fn(() => createRuntimeCatalog("img-local")) };
    const catalog = await run(DockerCatalog.live.resolve(), mesh, local);
    expect(local.getRuntimeCatalogSnapshot).toHaveBeenCalledTimes(1);
    expect(catalog.images.map((image) => image.id)).toEqual(["img-local"]);
  });
});
