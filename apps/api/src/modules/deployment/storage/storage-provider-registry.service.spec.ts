import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { DeploymentTriggerInput } from "@repo/api-contracts/modules/deployment/crud";
import { LocalStorageProviderService } from "./local/local-storage-provider.service";
import { NfsStorageProviderService } from "./nfs/nfs-storage-provider.service";
import { S3StorageProviderService } from "./s3/s3-storage-provider.service";
import { StorageProviderRegistryService } from "./storage-provider-registry.service";
import { VolumeStorageProviderService } from "./volume/volume-storage-provider.service";

describe("StorageProviderRegistryService", () => {
    const createRegistry = () =>
        new StorageProviderRegistryService([
            new LocalStorageProviderService(),
            new S3StorageProviderService(),
            new NfsStorageProviderService(),
            new VolumeStorageProviderService(),
        ]);

    it("should default to local storage provider when no storage config is provided", async () => {
        const registry = createRegistry();
        const input: DeploymentTriggerInput = {
            serviceId: "e6f5987e-7f79-4f40-9a14-42daf132f7ef",
            environment: "production",
            sourceType: "upload",
            sourceConfig: {
                fileName: "bundle.zip",
                fileSize: 1024,
            },
        };

        const binding = await registry.resolveStorageBinding(input);

        expect(binding).toMatchObject({
            storageType: "local",
            autoRedeployOnUpdate: false,
            updateStrategy: "manual_update_button",
            mountPath: "/workspace/storage",
        });
    });

    it("should resolve local storage with auto redeploy strategy when enabled", async () => {
        const registry = createRegistry();
        const input: DeploymentTriggerInput = {
            serviceId: "8f8fa2f8-3912-45eb-8ec8-4f89f7f3f8a5",
            environment: "production",
            sourceType: "upload",
            sourceConfig: {
                customData: {
                    storage: {
                        type: "local",
                        autoRedeployOnUpdate: true,
                        mountPath: "/workspace/data",
                        local: {
                            rootPath: "/srv/deployer/storage",
                        },
                    },
                },
            },
        };

        const binding = await registry.resolveStorageBinding(input);

        expect(binding).toMatchObject({
            storageType: "local",
            autoRedeployOnUpdate: true,
            updateStrategy: "auto_redeploy",
            mountPath: "/workspace/data",
        });
        expect(binding.metadata).toMatchObject({
            rootPath: "/srv/deployer/storage",
            watchPath: "/srv/deployer/storage",
        });
    });

    it("should resolve s3 storage config with manual update button strategy when auto redeploy is disabled", async () => {
        const registry = createRegistry();
        const input: DeploymentTriggerInput = {
            serviceId: "744f6f12-c31f-42e1-b470-08ca66ead8ca",
            environment: "production",
            sourceType: "upload",
            sourceConfig: {
                customData: {
                    storage: {
                        type: "s3",
                        autoRedeployOnUpdate: false,
                        s3: {
                            bucket: "deployer-artifacts",
                            region: "eu-west-3",
                        },
                    },
                },
            },
        };

        const binding = await registry.resolveStorageBinding(input);

        expect(binding).toMatchObject({
            storageType: "s3",
            autoRedeployOnUpdate: false,
            updateStrategy: "manual_update_button",
        });
        expect(binding.metadata).toMatchObject({
            bucket: "deployer-artifacts",
            region: "eu-west-3",
        });
    });

    it("should throw BadRequestException for unsupported storage provider type", async () => {
        const registry = createRegistry();
        const input: DeploymentTriggerInput = {
            serviceId: "698f1ffb-c560-42b6-b4d9-74f42d338d44",
            environment: "production",
            sourceType: "upload",
            sourceConfig: {
                customData: {
                    storage: {
                        type: "unsupported",
                    },
                },
            },
        };

        await expect(registry.resolveStorageBinding(input)).rejects.toThrow(BadRequestException);
    });

    it("should use service-level storage policy when trigger source config has no storage section", async () => {
        const registry = createRegistry();
        const input: DeploymentTriggerInput = {
            serviceId: "3072a3b0-cf50-4be5-8c9f-30e496f68095",
            environment: "production",
            sourceType: "upload",
            sourceConfig: {
                fileName: "bundle.zip",
                fileSize: 2048,
            },
        };

        const binding = await registry.resolveStorageBinding(input, {
            type: "local",
            autoRedeployOnUpdate: true,
            mountPath: "/workspace/persisted",
            local: {
                rootPath: "/srv/storage/service",
            },
        });

        expect(binding).toMatchObject({
            storageType: "local",
            autoRedeployOnUpdate: true,
            updateStrategy: "auto_redeploy",
            mountPath: "/workspace/persisted",
        });
        expect(binding.metadata).toMatchObject({
            rootPath: "/srv/storage/service",
        });
    });

    it("should let trigger storage config override service-level storage policy", async () => {
        const registry = createRegistry();
        const input: DeploymentTriggerInput = {
            serviceId: "f211e6f9-3553-4e13-a60d-8f9f535a2e9e",
            environment: "production",
            sourceType: "upload",
            sourceConfig: {
                customData: {
                    storage: {
                        type: "local",
                        autoRedeployOnUpdate: false,
                    },
                },
            },
        };

        const binding = await registry.resolveStorageBinding(input, {
            type: "local",
            autoRedeployOnUpdate: true,
            local: {
                rootPath: "/srv/storage/default",
            },
        });

        expect(binding).toMatchObject({
            storageType: "local",
            autoRedeployOnUpdate: false,
            updateStrategy: "manual_update_button",
        });
    });
});
