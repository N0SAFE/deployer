import { describe, expect, it } from "vitest";
import type { DeploymentStoragePolicyResolver } from "../base/storage-policy-resolver.interface";
import { StoragePolicyResolverRegistryService } from "./storage-policy-resolver-registry.service";
import { ServiceCustomDataStoragePolicyResolverService } from "./service-custom-data-storage-policy-resolver.service";
import { ServiceTopLevelStoragePolicyResolverService } from "./service-top-level-storage-policy-resolver.service";
import { RuntimeConfigurationStoragePolicyResolverService } from "./runtime-configuration-storage-policy-resolver.service";
import { runtimeConfigurationAccessor } from "@/core/modules/configuration/services/runtime-configuration-accessor";

describe("StoragePolicyResolverRegistryService", () => {
    const buildInput = (metadata: Record<string, unknown> | null) => ({
        serviceId: "service-1",
        serviceMetadata: metadata,
        sourceConfig: {},
        runtimeConfiguration: runtimeConfigurationAccessor.resolveForDeployment({
            serviceId: "service-1",
            projectId: "project-1",
            environment: "production",
            sourceType: "upload",
            serviceRecord: {
                providerId: "upload",
                builderId: "dockerfile",
                customDomains: null,
                environmentVariables: null,
                resourceLimits: null,
                deploymentStateMachine: null,
            },
        }),
    });

    it("should resolve policy from the highest priority resolver", () => {
        const highestPriorityResolver: DeploymentStoragePolicyResolver = {
            name: "highest",
            priority: 999,
            resolve: () => ({
                type: "s3",
                autoRedeployOnUpdate: true,
                s3: {
                    bucket: "bucket-high",
                },
            }),
        };
        const fallbackResolver: DeploymentStoragePolicyResolver = {
            name: "fallback",
            priority: 10,
            resolve: () => ({
                type: "local",
            }),
        };

        const registry = new StoragePolicyResolverRegistryService([
            fallbackResolver,
            highestPriorityResolver,
        ]);

        const policy = registry.resolveServiceStorageConfig(buildInput({}));
        expect(policy).toMatchObject({
            type: "s3",
            autoRedeployOnUpdate: true,
            s3: {
                bucket: "bucket-high",
            },
        });
    });

    it("should resolve policy from metadata.customData.storage before top-level metadata.storage", () => {
        const registry = new StoragePolicyResolverRegistryService([
            new RuntimeConfigurationStoragePolicyResolverService(),
            new ServiceTopLevelStoragePolicyResolverService(),
            new ServiceCustomDataStoragePolicyResolverService(),
        ]);

        const policy = registry.resolveServiceStorageConfig(
            buildInput({
                storage: {
                    type: "local",
                    autoRedeployOnUpdate: false,
                },
                customData: {
                    storage: {
                        type: "local",
                        autoRedeployOnUpdate: true,
                        mountPath: "/workspace/custom-data",
                    },
                },
            }),
        );

        expect(policy).toMatchObject({
            type: "local",
            autoRedeployOnUpdate: true,
            mountPath: "/workspace/custom-data",
        });
    });

    it("should prioritize first-class runtime configuration storage over metadata conventions", () => {
        const registry = new StoragePolicyResolverRegistryService([
            new RuntimeConfigurationStoragePolicyResolverService(),
            new ServiceTopLevelStoragePolicyResolverService(),
            new ServiceCustomDataStoragePolicyResolverService(),
        ]);

        const policy = registry.resolveServiceStorageConfig(
            (() => {
                const input = buildInput({
                    customData: {
                        storage: {
                            type: "local",
                            autoRedeployOnUpdate: false,
                            mountPath: "/workspace/metadata",
                        },
                    },
                });

                return {
                    ...input,
                    runtimeConfiguration: {
                        ...input.runtimeConfiguration,
                        service: {
                            ...input.runtimeConfiguration.service,
                            storage: {
                                type: "local",
                                autoRedeployOnUpdate: true,
                                mountPath: "/workspace/runtime-config",
                            },
                        },
                    },
                };
            })(),
        );

        expect(policy).toMatchObject({
            type: "local",
            autoRedeployOnUpdate: true,
            mountPath: "/workspace/runtime-config",
        });
    });
});
