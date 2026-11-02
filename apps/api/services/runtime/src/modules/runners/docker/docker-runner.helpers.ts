import * as fs from "node:fs";
import * as path from "node:path";

import type { DeploymentStorageBinding } from "@/modules/deployment/storage/base/storage-provider.interface";

import { RuntimeInvalid } from "../../../core/runtime.errors";
import { assertExecutorLabelAllowed } from "../base/reserved-labels";

import type { RuntimeExecutionInput } from "../runtime-runner.interface";
import type Docker from "dockerode";

/**
 * The docker runner's pure decisions: what a label, a command, an env var or a storage binding
 * becomes on the container. None of it touches the daemon, so the Effect runner and its specs
 * share it without a fake.
 */

const DEFAULT_TRAEFIK_SYNC_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 250;

export function sanitizeExecutorLabels(labels: Record<string, string> | undefined): Record<string, string> {
    if (!labels) {
        return {};
    }

    const sanitized: Record<string, string> = {};
    for (const [rawKey, rawValue] of Object.entries(labels)) {
        const key = rawKey.trim();
        const value = rawValue.trim();

        if (!key || key.length > 128) {
            continue;
        }
        if (!/^[a-zA-Z0-9._/-]+$/.test(key)) {
            continue;
        }
        assertExecutorLabelAllowed(key);
        if (!value || value.length > 512) {
            continue;
        }
        if (/[\u0000-\u001F\u007F]/.test(value)) {
            continue;
        }

        sanitized[key] = value;
    }

    return sanitized;
}

export function sanitizeStartupCommand(startupCommand: string | undefined): string | null {
    if (!startupCommand) {
        return null;
    }

    const normalized = startupCommand.trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length > 1024) {
        throw new RuntimeInvalid({ reason: "Executor startup command exceeds 1024 characters" });
    }

    if (/[\u0000\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized)) {
        throw new RuntimeInvalid({ reason: "Executor startup command contains unsupported control characters" });
    }

    return normalized;
}

export function sanitizeEnvironmentVariables(
    environmentVariables: Record<string, string> | undefined,
): string[] {
    if (!environmentVariables) {
        return [];
    }

    const sanitized: string[] = [];
    for (const [rawKey, rawValue] of Object.entries(environmentVariables)) {
        const key = rawKey.trim();
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || key.length > 128) {
            continue;
        }

        if (typeof rawValue !== "string" || /[\u0000]/.test(rawValue)) {
            continue;
        }

        sanitized.push(`${key}=${rawValue}`);
    }

    return sanitized;
}

export function materializeStorageBinding(storageBinding: DeploymentStorageBinding | null | undefined): {
    binds: string[];
    mounts: Docker.MountSettings[];
    labels: Record<string, string>;
} {
    if (!storageBinding) {
        return {
            binds: [],
            mounts: [],
            labels: {},
        };
    }

    const labels: Record<string, string> = {
        "deployer.storage.type": storageBinding.storageType,
        "deployer.storage.mount_path": storageBinding.mountPath,
        "deployer.storage.update_strategy": storageBinding.updateStrategy,
        "deployer.storage.auto_redeploy_on_update": String(
            storageBinding.autoRedeployOnUpdate,
        ),
    };

    const binds: string[] = [];
    const mounts: Docker.MountSettings[] = [];

    if (storageBinding.storageType === "local") {
        const rootPath = readMetadataString(storageBinding.metadata, "rootPath");
        if (rootPath) {
            const normalizedRootPath = normalizeLocalStorageRootPath(rootPath);
            binds.push(`${normalizedRootPath}:${storageBinding.mountPath}`);
        }
    }

    if (storageBinding.storageType === "volume") {
        const volumeName = readMetadataString(storageBinding.metadata, "volumeName");
        if (volumeName) {
            binds.push(`${volumeName}:${storageBinding.mountPath}`);
        }
    }

    if (storageBinding.storageType === "nfs") {
        const server = readMetadataString(storageBinding.metadata, "server");
        const exportPath = readMetadataString(storageBinding.metadata, "exportPath");
        const readOnly = readMetadataBoolean(storageBinding.metadata, "readOnly");

        if (server && exportPath) {
            mounts.push({
                Type: "volume",
                Source: buildNfsVolumeName(server, exportPath),
                Target: storageBinding.mountPath,
                ReadOnly: readOnly,
                VolumeOptions: {
                    NoCopy: false,
                    Labels: {},
                    DriverConfig: {
                        Name: "local",
                        Options: {
                            type: "nfs",
                            o: `addr=${server},rw`,
                            device: `:${exportPath}`,
                        },
                    },
                },
            });
        }
    }

    return {
        binds,
        mounts,
        labels,
    };
}

function readMetadataString(
    metadata: Record<string, unknown>,
    key: string,
): string | null {
    const value = metadata[key];
    return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readMetadataBoolean(
    metadata: Record<string, unknown>,
    key: string,
): boolean {
    return metadata[key] === true;
}

function buildNfsVolumeName(server: string, exportPath: string): string {
    const normalized = `${server}-${exportPath}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);

    return normalized.length > 0 ? `deployer-nfs-${normalized}` : "deployer-nfs-volume";
}

function normalizeLocalStorageRootPath(rootPath: string): string {
    const resolvedPath = path.isAbsolute(rootPath)
        ? rootPath
        : path.resolve(process.cwd(), rootPath);

    fs.mkdirSync(resolvedPath, { recursive: true });
    return resolvedPath;
}

export function buildFallbackSubdomain(serviceId: string): string {
    const normalized = serviceId
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32);

    if (!normalized) {
        return "service";
    }

    return normalized;
}

export function resolveRuntimeConvergenceConfig(input: RuntimeExecutionInput["convergenceConfig"]) {
    const traefikSyncMaxAttempts =
        typeof input?.traefikSyncMaxAttempts === "number" &&
        Number.isInteger(input.traefikSyncMaxAttempts) &&
        input.traefikSyncMaxAttempts > 0
            ? input.traefikSyncMaxAttempts
            : DEFAULT_TRAEFIK_SYNC_MAX_ATTEMPTS;
    const retryBaseDelayMs =
        typeof input?.retryBaseDelayMs === "number" &&
        Number.isInteger(input.retryBaseDelayMs) &&
        input.retryBaseDelayMs > 0
            ? input.retryBaseDelayMs
            : DEFAULT_RETRY_BASE_DELAY_MS;

    return {
        traefikSyncMaxAttempts,
        retryBaseDelayMs,
    };
}

