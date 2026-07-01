import { Injectable } from "@nestjs/common";
import { signMeshToken, verifyMeshToken } from "@repo/auth/mesh";
import { SystemMeshConfigService } from "@/core/modules/mesh/services/system-mesh-config.service";


/**
 * Type guard that narrows `unknown` to a record-like object so we can
 * index it with string keys. Used in place of `as Record<string, unknown>`
 * to avoid the runtime lie.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
const DEFAULT_REPLAY_WINDOW_MS = 30_000;

export const MESH_INTERNAL_KEY_HEADER = "x-mesh-internal-key";
export const MESH_LOCAL_ONLY_HEADER = "x-mesh-local-only";

@Injectable()
export class MeshInternalRequestService {
    constructor(private readonly meshConfigService: SystemMeshConfigService) {}

    buildInternalHeaders(input?: { request?: unknown; includeLocalOnly?: boolean }): Record<string, string> {
        const headers: Record<string, string> = {};

        if (input?.includeLocalOnly) {
            headers[MESH_LOCAL_ONLY_HEADER] = "1";
        }

        const credential = this.resolveInternalCredential(input?.request);
        if (credential) {
            headers[MESH_INTERNAL_KEY_HEADER] = credential;
        }

        return headers;
    }

    isLocalOnlyMeshRequest(request: unknown): boolean {
        const headers = this.resolveHeaders(request);
        if (!headers) {
            return false;
        }

        const localOnlyRaw = headers.get(MESH_LOCAL_ONLY_HEADER)?.trim().toLowerCase() ?? "";
        const localOnly = localOnlyRaw === "1" || localOnlyRaw === "true";

        if (!localOnly) {
            return false;
        }

        const credential = this.readInternalHeader(headers);
        return this.isTrustedInternalCredential(credential);
    }

    private resolveInternalCredential(request?: unknown): string | null {
        const configuredSecret = this.resolveSharedSecret();
        if (configuredSecret) {
            return signMeshToken(configuredSecret);
        }

        if (!request) {
            return null;
        }

        const headers = this.resolveHeaders(request);
        if (!headers) {
            return null;
        }

        const forwardedCredential = this.readInternalHeader(headers);
        return forwardedCredential && forwardedCredential.length > 0 ? forwardedCredential : null;
    }

    private isTrustedInternalCredential(credential: string | null): boolean {
        if (!credential) {
            return false;
        }

        const configuredSecret = this.resolveSharedSecret();
        if (!configuredSecret) {
            return credential.trim().length > 0;
        }

        if (credential.startsWith("v1.")) {
            return verifyMeshToken(credential, configuredSecret, this.resolveReplayWindowMs());
        }

        if (this.resolveStrictReplayGuard()) {
            return false;
        }

        return credential.trim() === configuredSecret;
    }

    private readInternalHeader(headers: Headers): string | null {
        const value =
            headers.get(MESH_INTERNAL_KEY_HEADER)
            ?? headers.get("X-Mesh-Internal-Key")
            ?? null;

        const trimmed = value?.trim() ?? "";
        return trimmed.length > 0 ? trimmed : null;
    }

    private resolveHeaders(request: unknown): Headers | null {
        if (!request) {
            return null;
        }

        if (request instanceof Headers) {
            return request;
        }

        if (request instanceof Request) {
            return request.headers;
        }

        if (typeof request !== "object") {
            return null;
        }

        const withHeaders = request as { headers?: unknown };
        if (typeof withHeaders.headers !== "undefined") {
            return this.resolveHeaders(withHeaders.headers);
        }

        const normalized = new Headers();
        for (const [key, rawValue] of Object.entries(request as Record<string, unknown>)) {
            if (typeof rawValue === "string") {
                normalized.set(key, rawValue);
                continue;
            }

            if (Array.isArray(rawValue)) {
                const values = rawValue
                    .map((item) => (typeof item === "string" ? item : null))
                    .filter((item): item is string => item !== null);
                if (values.length > 0) {
                    normalized.set(key, values.join(","));
                }
            }
        }

        return normalized.keys().next().done ? null : normalized;
    }

    private resolveSharedSecret(): string | null {
        const configured = this.meshConfigService.getStreamSharedSecret();
        if (typeof configured === "string" && configured.trim().length > 0) {
            return configured.trim();
        }

        const fromEnv = process.env.MESH_STREAM_SHARED_SECRET;
        if (typeof fromEnv === "string" && fromEnv.trim().length > 0) {
            return fromEnv.trim();
        }

        return null;
    }

    private resolveReplayWindowMs(): number {
        const raw = process.env.MESH_REPLAY_WINDOW_MS;
        if (typeof raw === "number" && Number.isFinite(raw)) {
            return raw;
        }

        if (typeof raw !== "string") {
            return DEFAULT_REPLAY_WINDOW_MS;
        }

        const parsed = Number(raw);
        return Number.isFinite(parsed) ? parsed : DEFAULT_REPLAY_WINDOW_MS;
    }

    private resolveStrictReplayGuard(): boolean {
        const raw = process.env.MESH_STRICT_REPLAY_GUARD;
        if (typeof raw === "boolean") {
            return raw;
        }

        if (typeof raw !== "string") {
            return false;
        }

        return raw.trim().toLowerCase() === "true";
    }
}