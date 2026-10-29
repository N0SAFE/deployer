/**
 * Reading entities a peer node sent over the mesh into the runtime's own shapes: statuses, health, ports, image
 * references and the container hash. Pure, so every coercion rule is tested without a mesh.
 */
import { createHash } from "node:crypto";
import { type DockerContainer } from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

export const DEPLOYMENT_ENVIRONMENTS = new Set(["production", "staging", "preview", "development"] as const);

export function normalizeContainerGroupName(name: string): string {
    return name.replace(/([._-])\d+$/, "");
}

export function buildFallbackImageRepository(imageId: string): string {
    const normalizedId = imageId.replace(/^sha256:/, "").trim();
    const shortId = normalizedId.length > 0 ? normalizedId.slice(0, 12) : "unknown";
    return `untagged/${shortId}`;
}

export function normalizeImageRegistrySegment(value: unknown): string {
    if (typeof value !== "string") {
        return "docker.io";
    }

    const normalized = value.trim();
    if (normalized.length === 0 || normalized === "<none>" || isPlaceholderImageSegment(normalized)) {
        return "docker.io";
    }

    return normalized;
}

export function normalizeImageRepositoryPath(value: unknown): string {
    if (typeof value !== "string") {
        return "library/unknown";
    }

    const segments = value
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0 && segment !== "<none>" && !isPlaceholderImageSegment(segment));

    if (segments.length === 0) {
        return "library/unknown";
    }

    return segments.join("/");
}

export function normalizeImageTag(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    if (normalized.length === 0 || normalized === "<none>" || isPlaceholderImageSegment(normalized)) {
        return null;
    }

    return normalized;
}

export function normalizeImageDigest(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    if (normalized.length === 0 || normalized === "<none>" || isPlaceholderImageSegment(normalized)) {
        return null;
    }

    return normalized;
}

export function normalizeImageSizeBytes(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return null;
    }

    return value;
}

export function normalizeImageLabels(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object") {
        return {};
    }

    const entries = Object.entries(isRecord(value) ? value : {}).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
    );

    return Object.fromEntries(entries);
}

export function isPlaceholderImageSegment(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === "undefined" || normalized === "null" || normalized === "none" || normalized === "nan";
}

export function normalizeComparableValue(value: string | number | boolean | null | undefined): string | number {
    if (typeof value === "number") return value;
    if (typeof value === "boolean") return value ? 1 : 0;
    if (typeof value === "string") return value;
    return "";
}

export function buildContainerHash(input: {
    managedBy: DockerContainer["managedBy"];
    managedDeploymentId: string | null;
    managedServiceId: string | null;
    managedProjectId: string | null;
    name: string;
    projectId: string;
    serviceId: string;
    imageId: string | null;
    environment: DockerContainer["environment"];
    ports: DockerContainer["ports"];
}): string {
    const identity = input.managedDeploymentId
        ? {
              kind: "deployment",
              managedBy: input.managedBy,
              deploymentId: input.managedDeploymentId,
          }
        : {
              kind: "runtime",
              managedBy: input.managedBy,
              projectId: input.managedProjectId ?? input.projectId,
              serviceId: input.managedServiceId ?? input.serviceId,
              name: input.name,
              imageId: input.imageId,
              environment: input.environment,
          };

    return createHash("sha256")
        .update(
            JSON.stringify({
                identity,
                ports: [...input.ports]
                    .map((port) => `${String(port.containerPort)}/${port.protocol}`)
                    .sort(),
            }),
        )
        .digest("hex");
}

export function asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function asNullableString(value: unknown): string | null {
    return asNonEmptyString(value);
}

export function asIsoString(value: unknown): string {
    if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
        return value;
    }

    return new Date().toISOString();
}

export function asNullableIsoString(value: unknown): string | null {
    if (value == null) {
        return null;
    }

    return asIsoString(value);
}

export function normalizeStatus(value: unknown): DockerContainer["status"] {
    const normalized = typeof value === "string" ? value.toLowerCase() : "";

    switch (normalized) {
        case "created":
            return "created";
        case "running":
            return "running";
        case "paused":
            return "paused";
        case "restarting":
            return "restarting";
        case "exited":
            return "exited";
        case "dead":
            return "dead";
        case "unknown":
            return "unknown";
        default:
            return "unknown";
    }
}

export function normalizeHealth(value: unknown): DockerContainer["health"] {
    const normalized = typeof value === "string" ? value.toLowerCase() : "";

    switch (normalized) {
        case "healthy":
            return "healthy";
        case "unhealthy":
            return "unhealthy";
        case "starting":
            return "starting";
        case "none":
            return "none";
        default:
            return "none";
    }
}

export function normalizeEnvironment(value: unknown): DockerContainer["environment"] {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.toLowerCase();
    return DEPLOYMENT_ENVIRONMENTS.has(normalized as "production" | "staging" | "preview" | "development")
        ? (normalized as DockerContainer["environment"])
        : null;
}

export function normalizePercent(value: unknown): number | null {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
        return null;
    }

    return value;
}

export function normalizeNonNegativeInt(value: unknown): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
        return 0;
    }

    return value;
}

export function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

export function normalizePorts(value: unknown): DockerContainer["ports"] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => {
            if (!item || typeof item !== "object") {
                return null;
            }

            const port = isRecord(item) ? item : {};
            const containerPort =
                typeof port.containerPort === "number" &&
                Number.isInteger(port.containerPort) &&
                port.containerPort >= 1 &&
                port.containerPort <= 65535
                    ? port.containerPort
                    : null;

            if (containerPort === null) {
                return null;
            }

            const hostPort =
                typeof port.hostPort === "number" &&
                Number.isInteger(port.hostPort) &&
                port.hostPort >= 1 &&
                port.hostPort <= 65535
                    ? port.hostPort
                    : null;

            const protocol = port.protocol === "udp" ? "udp" : "tcp";

            return {
                containerPort,
                hostPort,
                protocol,
            };
        })
        .filter((item): item is DockerContainer["ports"][number] => item !== null);
}

export function formatError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

export function toError(error: unknown): Error {
    if (error instanceof Error) {
        return error;
    }

    return new Error(String(error));
}
