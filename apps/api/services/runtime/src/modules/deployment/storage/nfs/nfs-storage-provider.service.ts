import { Effect } from "effect";
import z from "zod/v4";

import type { DeploymentTriggerInput } from "@deployer/runtime-contracts/modules/deployment/crud";

import { RuntimeInvalid } from "../../../../core/runtime.errors";
import {
    deploymentStorageBindingSchema,
    type DeploymentStorageBinding,
    type DeploymentStorageProvider,
} from "../base/storage-provider.interface";
import {
    extractStorageConfig,
    resolveAutoRedeployOnUpdate,
    resolveMountPath,
    resolveUpdateStrategy,
} from "../base/storage-provider.utils";

import type { DeploymentStoragePolicy } from "../base/storage-policy.schema";

const nfsStorageConfigSchema = z
    .object({
        type: z.literal("nfs"),
        nfs: z.object({
            server: z.string().min(1),
            exportPath: z.string().min(1),
            readOnly: z.boolean().optional(),
        }),
    })
    .loose();

export const nfsStorageProvider: DeploymentStorageProvider = {
    storageType: "nfs",

    resolveStorageBinding(
        input: DeploymentTriggerInput,
        serviceStorageConfig?: DeploymentStoragePolicy,
    ): Effect.Effect<DeploymentStorageBinding | null, RuntimeInvalid> {
        const storageConfig = extractStorageConfig(input, serviceStorageConfig);
        const parsed = nfsStorageConfigSchema.safeParse(storageConfig);

        if (!parsed.success) {
            if (storageConfig?.type === "nfs") {
                return Effect.fail(new RuntimeInvalid({ reason: "NFS storage requires storage.nfs.server and storage.nfs.exportPath in sourceConfig.customData" }));
            }
            return Effect.succeed(null);
        }

        const autoRedeployOnUpdate = resolveAutoRedeployOnUpdate(storageConfig);

        return Effect.sync(() =>
            deploymentStorageBindingSchema.parse({
                storageType: "nfs",
                autoRedeployOnUpdate,
                updateStrategy: resolveUpdateStrategy(autoRedeployOnUpdate),
                mountPath: resolveMountPath(storageConfig),
                metadata: {
                    server: parsed.data.nfs.server,
                    exportPath: parsed.data.nfs.exportPath,
                    readOnly: parsed.data.nfs.readOnly ?? false,
                },
            }),
        );
    }
};
