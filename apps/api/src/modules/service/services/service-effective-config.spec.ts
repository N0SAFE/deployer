import { describe, it, expect } from "vitest";
import {
    DEFAULT_HEALTH_CHECK,
    emptyEffectiveConfig,
    foldServiceChain,
    mergeServiceConfig,
} from "./service-effective-config";
import type { Service } from "@repo/contracts-entities";

/** Build a minimal flat service DTO for testing config merging. */
function makeService(overrides: Partial<Service> = {}): Service {
    return {
        id: "00000000-0000-4000-8000-000000000001",
        projectId: "00000000-0000-4000-8000-000000000002",
        name: "svc",
        description: null,
        type: "application",
        providerId: "manual",
        providerConfig: null,
        builderId: "manual",
        builderConfig: null,
        port: null,
        environmentVariables: null,
        resourceLimits: null,
        healthCheckPath: DEFAULT_HEALTH_CHECK.path,
        healthCheckInterval: DEFAULT_HEALTH_CHECK.interval,
        healthCheckTimeout: DEFAULT_HEALTH_CHECK.timeout,
        healthCheckRetries: DEFAULT_HEALTH_CHECK.retries,
        deploymentRetention: null,
        traefikConfig: null,
        customDomains: null,
        isActive: true,
        metadata: null,
        parentId: null,
        parentPath: null,
        depth: 0,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    } as Service;
}

describe("mergeServiceConfig (Compose-merge inheritance)", () => {
    it("child inherits the parent port when its own is null", () => {
        const parent = makeService({ port: 3000 });
        const child = makeService({ port: null });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.port).toBe(3000);
    });

    it("child overrides the parent port when it sets one", () => {
        const parent = makeService({ port: 3000 });
        const child = makeService({ port: 8080 });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.port).toBe(8080);
    });

    it("environment variables merge key-by-key with the child winning", () => {
        const parent = makeService({ environmentVariables: { A: "1", B: "2" } });
        const child = makeService({ environmentVariables: { B: "child", C: "3" } });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.environmentVariables).toEqual({ A: "1", B: "child", C: "3" });
    });

    it("child with null env inherits ALL parent env vars", () => {
        const parent = makeService({ environmentVariables: { A: "1", B: "2" } });
        const child = makeService({ environmentVariables: null });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.environmentVariables).toEqual({ A: "1", B: "2" });
    });

    it("health check: child left at defaults inherits the parent's custom health check", () => {
        const parent = makeService({
            healthCheckPath: "/healthz",
            healthCheckInterval: 60,
            healthCheckTimeout: 20,
            healthCheckRetries: 5,
        });
        // Child never touched its health check → DB defaults.
        const child = makeService({});
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.healthCheck).toEqual({
            path: "/healthz",
            interval: 60,
            timeout: 20,
            retries: 5,
        });
    });

    it("health check: child overrides only the path, inherits the rest", () => {
        const parent = makeService({ healthCheckPath: "/healthz", healthCheckInterval: 60 });
        const child = makeService({ healthCheckPath: "/custom" });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.healthCheck).toEqual({
            path: "/custom",
            interval: 60,
            timeout: DEFAULT_HEALTH_CHECK.timeout,
            retries: DEFAULT_HEALTH_CHECK.retries,
        });
    });

    it("resource limits merge field-by-field, child wins", () => {
        const parent = makeService({ resourceLimits: { memory: "512m", cpu: "1" } });
        const child = makeService({ resourceLimits: { memory: "1g" } });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.resourceLimits).toEqual({ memory: "1g", cpu: "1", storage: undefined });
    });

    it("providerConfig is inherited when the child has none", () => {
        const githubConfig = {
            sourceUrl: "https://github.com/acme/app",
            branch: "main",
            rootPath: "/",
            buildContext: "/",
            autoSyncEnabled: false,
            webhookEnabled: false,
            authSecretRef: "",
        };
        const parent = makeService({
            providerId: "github",
            providerConfig: githubConfig,
        });
        const child = makeService({ providerConfig: null });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.providerConfig).toEqual(githubConfig);
    });

    it("customDomains are replaced, not concatenated, when the child sets its own", () => {
        const parent = makeService({ customDomains: ["api.example.com"] });
        const child = makeService({ customDomains: ["child.example.com"] });
        const effective = mergeServiceConfig(mergeServiceConfig(emptyEffectiveConfig(), parent), child);
        expect(effective.customDomains).toEqual(["child.example.com"]);
    });
});

describe("foldServiceChain (ancestor chain, root-first)", () => {
    it("deep chain: leaf inherits root env unless an intermediate overrides it", () => {
        const root = makeService({
            id: "00000000-0000-4000-8000-000000000010",
            environmentVariables: { SHARED: "root", ROOT_ONLY: "yes", VERSION: "1" },
            port: 9000,
        });
        const mid = makeService({
            id: "00000000-0000-4000-8000-000000000011",
            parentId: root.id,
            parentPath: root.id,
            depth: 1,
            environmentVariables: { VERSION: "2", MID_ONLY: "mid" },
            port: null,
        });
        const leaf = makeService({
            id: "00000000-0000-4000-8000-000000000012",
            parentId: mid.id,
            parentPath: `${root.id}/${mid.id}`,
            depth: 2,
            environmentVariables: null,
            port: null,
        });

        const effective = foldServiceChain([root, mid], leaf);
        expect(effective.port).toBe(9000);
        expect(effective.environmentVariables).toEqual({
            SHARED: "root",
            ROOT_ONLY: "yes",
            VERSION: "2",
            MID_ONLY: "mid",
        });
    });
});
