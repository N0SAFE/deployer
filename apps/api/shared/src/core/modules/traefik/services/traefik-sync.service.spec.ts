import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { StorageFailure } from "../../database/storage";
import { ConfigNotFoundError } from "../errors";

import { makeTraefikFileSystem } from "./traefik-file-system.service";
import { makeTraefikSync } from "./traefik-sync.service";
import { makeTraefikService } from "./traefik.service";

import type { TraefikRepositoryShape } from "../repositories/traefik.repository";

const config = {
  id: "cfg-12345678",
  serviceId: "svc-12345678",
  domain: "example.com",
  fullDomain: "api.example.com",
  port: 3000,
  sslEnabled: true,
  sslProvider: "letsencrypt",
  serviceHost: "web",
  servicePort: 3000,
  domainRoutes: [{ id: "route-12345678", hostRule: "Host(`api.example.com`)", entryPoint: "web" }],
  middlewares: [],
};

function repoWith(overrides: Record<string, unknown> = {}) {
  return {
    getCompleteServiceConfig: vi.fn(() => Effect.succeed(config)),
    getServiceById: vi.fn(() => Effect.succeed({ projectId: "p1" })),
    getProjectById: vi.fn(() => Effect.succeed({ name: "shop" })),
    updateConfigSyncStatus: vi.fn(() => Effect.succeed(undefined)),
    createConfigFile: vi.fn(() => Effect.succeed(undefined)),
    ...overrides,
  } as unknown as TraefikRepositoryShape;
}

describe("TraefikSync", () => {
  it("writes the generated YAML under the project folder and records the sync", async () => {
    const basePath = await mkdtemp(join(tmpdir(), "traefik-"));
    const fileSystem = makeTraefikFileSystem({ basePath, backupPath: join(basePath, "backup") });
    const repository = repoWith();
    const sync = makeTraefikSync({ repository, fileSystem });

    const result = await Effect.runPromise(sync.syncServiceConfiguration("cfg-12345678"));

    expect(result).toMatchObject({ success: true, action: "created", configName: "api.example.com" });
    const written = await readFile(join(basePath, "dynamic", "projects", "shop", "service-svc-1234-cfg-1234.yml"), "utf8");
    expect(written).toContain("Host(`api.example.com`)");
    expect(repository.updateConfigSyncStatus).toHaveBeenCalledOnce();
  });

  it("answers an unknown configuration as a failed result, not an error", async () => {
    const sync = makeTraefikSync({
      repository: repoWith({ getCompleteServiceConfig: () => Effect.succeed(null) }),
      fileSystem: makeTraefikFileSystem({ basePath: "/nowhere", backupPath: "/nowhere" }),
    });
    expect(await Effect.runPromise(sync.syncServiceConfiguration("x"))).toMatchObject({ success: false, message: "Configuration not found in database" });
  });

  it("reports a write failure as a failed result and skips the status update", async () => {
    const dir = await mkdtemp(join(tmpdir(), "traefik-"));
    const blocker = join(dir, "file");
    await writeFile(blocker, "");
    const repository = repoWith();
    const sync = makeTraefikSync({ repository, fileSystem: makeTraefikFileSystem({ basePath: blocker, backupPath: blocker }) });

    const result = await Effect.runPromise(sync.syncServiceConfiguration("cfg-12345678"));

    expect(result).toMatchObject({ success: false, action: "error" });
    expect(repository.updateConfigSyncStatus).not.toHaveBeenCalled();
  });

  it("fails with the typed storage failure when the database cannot be read", async () => {
    const sync = makeTraefikSync({
      repository: repoWith({ getCompleteServiceConfig: () => Effect.fail(new StorageFailure({})) }),
      fileSystem: makeTraefikFileSystem({ basePath: "/nowhere", backupPath: "/nowhere" }),
    });
    expect(await Effect.runPromise(Effect.flip(sync.syncServiceConfiguration("x")))).toBeInstanceOf(StorageFailure);
  });
});

describe("TraefikService", () => {
  const sync = makeTraefikSync({ repository: repoWith(), fileSystem: makeTraefikFileSystem({ basePath: "/nowhere", backupPath: "/nowhere" }) });

  it("fails with ConfigNotFoundError when the service has no Traefik config", async () => {
    const service = makeTraefikService({ repository: repoWith({ getServiceConfigByServiceId: () => Effect.succeed(undefined) }), sync });
    expect(await Effect.runPromise(Effect.flip(service.syncServiceConfiguration("svc")))).toBeInstanceOf(ConfigNotFoundError);
  });

  it("validates a stored configuration", async () => {
    const service = makeTraefikService({
      repository: repoWith({ getCompleteServiceConfig: () => Effect.succeed({ ...config, port: 0, serviceTargets: [] }) }),
      sync,
    });
    const result = await Effect.runPromise(service.validateConfiguration("cfg"));
    expect(result.isValid).toBe(false);
    expect(result.errors.map((e) => e.code)).toEqual(["INVALID_PORT"]);
    expect(result.warnings).toHaveLength(1);
  });
});
