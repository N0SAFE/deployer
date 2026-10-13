/**
 * Cloudflare SDK helpers shared by the DnsProvidersController (HTTP) and the
 * DnsProvidersService (server-side provisioning). Single source of truth for
 * record normalization + create-param building, so no cast/duplication.
 */
import z from "zod/v4";
import type { RecordCreateParams, RecordResponse } from "cloudflare/resources/dns/records";

export type SupportedRecordType = "A" | "AAAA" | "CNAME" | "TXT";
export type RecordListType = NonNullable<import("cloudflare/resources/dns/records").RecordListParams["type"]>;

/**
 * Runtime schema for a Cloudflare SDK record object. The SDK's union type
 * varies content shape per record type (single string for A/AAAA/CNAME, and
 * historically string[] for TXT on some versions), so we normalize it.
 */
export const cloudflareSdkRecordSchema = z.object({
    id: z.string(),
    type: z.string(),
    name: z.string(),
    content: z.union([z.string(), z.array(z.string())]).optional(),
    ttl: z.number().optional(),
    proxied: z.boolean().optional(),
});

export interface NormalizedDnsRecord {
    id: string;
    type: string;
    name: string;
    content: string;
    ttl: number;
    proxied: boolean;
}

/**
 * Normalize a Cloudflare SDK record response into the contract shape.
 * Uses Zod (not casts) at the external-data boundary, per repo rules.
 */
export function toDnsRecordShape(r: RecordResponse): NormalizedDnsRecord {
    const parsed = cloudflareSdkRecordSchema.safeParse(r);
    if (!parsed.success) {
        return { id: "", type: "", name: "", content: "", ttl: 1, proxied: false };
    }
    const { id, type, name, content, ttl, proxied } = parsed.data;
    return {
        id,
        type,
        name,
        content: Array.isArray(content) ? content.join(" ") : (content ?? ""),
        ttl: ttl ?? 1,
        proxied: proxied ?? false,
    };
}

/**
 * Build a type-safe Cloudflare create-record param object for the supported
 * record types. Returns null for unsupported types.
 */
export function buildRecordCreateParams(input: {
    zoneId: string;
    type: SupportedRecordType;
    name: string;
    content: string;
    ttl?: number;
    proxied?: boolean;
}): RecordCreateParams | null {
    const common = {
        zone_id: input.zoneId,
        name: input.name,
        ttl: input.ttl ?? 1,
        ...(input.proxied != null ? { proxied: input.proxied } : {}),
    } as const;
    switch (input.type) {
        case "A":
            return { ...common, type: "A", content: input.content };
        case "AAAA":
            return { ...common, type: "AAAA", content: input.content };
        case "CNAME":
            return { ...common, type: "CNAME", content: input.content };
        case "TXT":
            return { ...common, type: "TXT", content: input.content };
        default:
            return null;
    }
}

// ─── Tunnel shape helpers ──────────────────────────────────────────────────

export interface TunnelConnectionShape {
    id: string | null;
    clientId: string | null;
    coloName: string | null;
    clientVersion: string | null;
    isPendingReconnect: boolean | null;
    openedAt: string | null;
    originIp: string | null;
}

export interface TunnelShape {
    id: string;
    name: string | null;
    status: "inactive" | "degraded" | "healthy" | "down" | null;
    tunType: string | null;
    createdAt: string | null;
    connections: TunnelConnectionShape[];
}

/**
 * Raw Cloudflare tunnel connection payload. The SDK's `Connection` type only
 * declares `{ uuid, colo_name }` while the API carries more fields
 * (`is_pending_reconnect`, `opened_at`, …), so the schema accepts both
 * `uuid` (tunnel list) and `id` (connections endpoint) plus every optional
 * extension field, passthrough for forward-compatibility.
 */
const cloudflareTunnelConnectionSchema = z
    .object({
        uuid: z.string().optional(),
        id: z.string().optional(),
        client_id: z.string().nullish(),
        colo_name: z.string().nullish(),
        client_version: z.string().nullish(),
        is_pending_reconnect: z.boolean().nullish(),
        opened_at: z.string().nullish(),
        origin_ip: z.string().nullish(),
    })
    .passthrough();

/**
 * Raw Cloudflare tunnel summary payload (list + get endpoints).
 * Status is closed over the API's documented enum.
 */
export const cloudflareTunnelStatusSchema = z.enum(["inactive", "degraded", "healthy", "down"]);

const cloudflareTunnelSummarySchema = z
    .object({
        id: z.string(),
        name: z.string().nullish(),
        status: cloudflareTunnelStatusSchema.nullish(),
        tun_type: z.string().nullish(),
        created_at: z.string().nullish(),
    })
    .passthrough();

/** The all-null connection shape used when parsing fails. */
const emptyTunnelConnectionShape: TunnelConnectionShape = {
    id: null,
    clientId: null,
    coloName: null,
    clientVersion: null,
    isPendingReconnect: null,
    openedAt: null,
    originIp: null,
};

/**
 * Normalize a raw Cloudflare tunnel connection into the wire shape.
 *
 * Takes `unknown` on purpose: the SDK types under-declare the wire payload.
 * Validation runs through {@link cloudflareTunnelConnectionSchema}; malformed
 * payloads degrade to the null shape instead of throwing.
 */
export function toTunnelConnectionShape(input: unknown): TunnelConnectionShape {
    const parsed = cloudflareTunnelConnectionSchema.safeParse(input);
    if (!parsed.success) {
        return emptyTunnelConnectionShape;
    }
    const c = parsed.data;
    return {
        id: c.uuid ?? c.id ?? null,
        clientId: c.client_id ?? null,
        coloName: c.colo_name ?? null,
        clientVersion: c.client_version ?? null,
        isPendingReconnect: c.is_pending_reconnect ?? null,
        openedAt: c.opened_at ?? null,
        originIp: c.origin_ip ?? null,
    };
}

/**
 * Normalize a raw Cloudflare tunnel summary into the wire shape.
 * Validation runs through {@link cloudflareTunnelSummarySchema}.
 */
export function toTunnelShape(
    input: unknown,
    connections: TunnelConnectionShape[] = [],
): TunnelShape {
    const parsed = cloudflareTunnelSummarySchema.safeParse(input);
    if (!parsed.success) {
        return { id: "", name: null, status: null, tunType: null, createdAt: null, connections };
    }
    const t = parsed.data;
    return {
        id: t.id,
        name: t.name ?? null,
        status: t.status ?? null,
        tunType: t.tun_type ?? null,
        createdAt: t.created_at ?? null,
        connections,
    };
}

/**
 * Normalize a Cloudflare SDK error into a stable, user-facing message.
 * Distinguishes network/connection failures from auth/permission failures so
 * the UI can guide the user ("check connectivity" vs "check token").
 */
export function toCloudflareErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        const name = error.name ?? "";
        const message = error.message ?? "";
        if (name === "APIConnectionError" || /connection|ECONNREFUSED|ENOTFOUND|fetch failed|network/i.test(message)) {
            return "Unable to reach Cloudflare — check this server's internet connection (or tunnel/proxy).";
        }
        if (name === "AuthenticationError" || /auth|token|unauthorized|permission|forbidden/i.test(message)) {
            return "Cloudflare rejected the API token — it may be invalid, expired, or missing required permissions (Zone:Read / DNS:Edit).";
        }
        if (/rate.?limit/i.test(message)) {
            return "Cloudflare rate limit reached — try again shortly.";
        }
        return message || "Unknown Cloudflare error";
    }
    return "Unknown Cloudflare error";
}
