import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { StorageFailure } from "../../database/storage";
import { TraefikFileNotFound } from "../errors";

import { makeTraefikFileSystem } from "./traefik-file-system.service";

import type { TraefikRepositoryShape } from "../repositories/traefik.repository";

const SERVICE = "aaaaaaaa-1111";
const CONFIG = "bbbbbbbb-2222";
const FILE = "service-aaaaaaaa-bbbbbbbb.yml";

function repo(overrides: Record<string, unknown> = {}) {
  return {
    getAllStaticFiles: vi.fn(() => Effect.succeed([])),
    getAllProjects: vi.fn(() => Effect.succeed([{ id: "p1", name: "shop" }])),
    getProjectIdByName: vi.fn((name: string) => Effect.succeed(name === "shop" ? "p1" : null)),
    getServiceConfigsByProject: vi.fn(() =>
      Effect.succeed([{ id: CONFIG, serviceId: SERVICE, domain: "example.com", fullDomain: "api.example.com", port: 3000, sslEnabled: true, configContent: null, updatedAt: null }]),
    ),
    getAllNewSslCertificates: vi.fn(() => Effect.succeed([])),
    getAllNewMiddleware: vi.fn(() => Effect.succeed([])),
    getAllServiceConfigs: vi.fn(() => Effect.succeed([])),
    createStaticFile: vi.fn(() => Effect.succeed(undefined)),
    createBackup: vi.fn(() => Effect.succeed(undefined)),
    ...overrides,
  } as unknown as TraefikRepositoryShape;
}

const fsOver = (repository: TraefikRepositoryShape) => makeTraefikFileSystem({ basePath: "/cfg", backupPath: "/bak" }, repository);

describe("TraefikFileSystem conventions", () => {
  const fs = fsOver(repo());

  it("names and parses service config files", () => {
    expect(fs.generateServiceConfigFileName(SERVICE, CONFIG)).toBe(FILE);
    expect(fs.parseServiceConfigFileName(FILE)).toEqual({ serviceId: "aaaaaaaa", configId: "bbbbbbbb" });
    expect(fs.parseServiceConfigFileName("nope.yml")).toBeNull();
    expect(fs.generateServiceConfigPath(SERVICE, CONFIG, "shop")).toBe(`/cfg/dynamic/projects/shop/${FILE}`);
    expect(fs.generateServiceConfigPath(SERVICE, CONFIG)).toBe(`/cfg/dynamic/standalone/${FILE}`);
  });

  it("re-roots every path", () => {
    fs.setBasePaths({ basePath: "/other", backupPath: "/other-bak" });
    expect(fs.getFileSystemPaths()).toMatchObject({ basePath: "/other", dynamicPath: "/other/dynamic", backupPath: "/other-bak" });
  });

  it("recognises project files", () => {
    const f = fsOver(repo());
    expect(f.isProjectFile("/cfg/dynamic/projects/shop/a.yml", "shop")).toBe(true);
    expect(f.extractProjectFromPath("/cfg/dynamic/projects/shop/a.yml")).toBe("shop");
    expect(f.extractProjectFromPath("/elsewhere/a.yml")).toBeNull();
  });
});

describe("TraefikFileSystem virtual filesystem", () => {
  it("lists a project's config files from the database", async () => {
    const files = await Effect.runPromise(fsOver(repo()).getProjectConfigFiles("shop"));
    expect(files).toEqual([`/dynamic/projects/shop/${FILE}`]);
  });

  it("builds the project tree with generated content", async () => {
    const tree = await Effect.runPromise(fsOver(repo()).getProjectFileSystem("shop"));
    expect(tree.files.map((f) => f.name)).toEqual([FILE]);
    expect(tree.files[0]?.content).toContain("fullDomain: api.example.com");
  });

  it("reads a service config as generated YAML and falls back to a placeholder when it is gone", async () => {
    const fs = fsOver(repo());
    expect((await Effect.runPromise(fs.getFileContent(`/dynamic/projects/shop/${FILE}`))).content).toContain('Host(`api.example.com`)');
    const gone = await Effect.runPromise(fs.getFileContent("/dynamic/projects/shop/service-cccccccc-dddddddd.yml"));
    expect(gone.content).toContain("Placeholder service configuration");
    expect(gone.mimeType).toBe("text/yaml");
  });

  it("fails with TraefikFileNotFound for an unknown project or path", async () => {
    const fs = fsOver(repo());
    expect(await Effect.runPromise(Effect.flip(fs.getFileContent(`/dynamic/projects/ghost/${FILE}`)))).toBeInstanceOf(TraefikFileNotFound);
    expect(await Effect.runPromise(Effect.flip(fs.getFileContent("/nowhere.txt")))).toBeInstanceOf(TraefikFileNotFound);
  });

  it("serves the default main config when no traefik.yml is stored, and the stored one otherwise", async () => {
    expect((await Effect.runPromise(fsOver(repo()).getFileContent("/traefik.yml"))).content).toContain("entryPoints:");
    const stored = repo({ getAllStaticFiles: () => Effect.succeed([{ fileName: "traefik.yml", fileContent: "custom: true" }]) });
    expect((await Effect.runPromise(fsOver(stored).getFileContent("/traefik.yml"))).content).toBe("custom: true");
  });

  it("writes static files, reporting a refused path instead of failing", async () => {
    const repository = repo();
    const fs = fsOver(repository);
    expect(await Effect.runPromise(fs.writeFile("/static/extra.yml", "a: 1"))).toMatchObject({ success: true, action: "created", size: 4 });
    expect(repository.createStaticFile).toHaveBeenCalledOnce();
    expect(await Effect.runPromise(fs.writeFile("/ssl/x.yml", "a: 1"))).toMatchObject({ success: false, action: "error" });
  });

  it("lists nothing, rather than failing, when the database is down", async () => {
    const down = repo({ getAllServiceConfigs: () => Effect.fail(new StorageFailure({})) });
    expect(await Effect.runPromise(fsOver(down).getAllConfigFiles())).toEqual([]);
  });

  it("fails the tree read with the typed storage failure", async () => {
    const down = repo({ getAllProjects: () => Effect.fail(new StorageFailure({})) });
    expect(await Effect.runPromise(Effect.flip(fsOver(down).listProjects()))).toBeInstanceOf(StorageFailure);
  });

  it("backs a file up in the backups table", async () => {
    const repository = repo({ getAllStaticFiles: () => Effect.succeed([{ id: "s1", fileName: "extra.yml", relativePath: "/static/extra.yml", fileContent: "a: 1" }]) });
    const result = await Effect.runPromise(fsOver(repository).backupFile("/static/extra.yml"));
    expect(result).toMatchObject({ success: true, action: "created", size: 4 });
    expect(repository.createBackup).toHaveBeenCalledOnce();
  });
});
