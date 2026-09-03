/**
 * Cloudflare App Service — the "app" model for a Cloudflare DNS provider.
 *
 * A provider "app" is one `dns_providers` row (token-backed). This service
 * owns:
 *   - CRUD of provider apps (create verifies the token at runtime).
 *   - LIVE runtime state (token validity, account id) with a short in-memory
 *     TTL — the DB `state` column is only a display cache, never the source
 *     of truth.
 *   - Feature flags (dnsManagement / tunnelManagement) that other modules
 *     gate on.
 *
 * Tunnel + zone/record operations live in CloudflareTunnelService and
 * CloudflareDnsProviderService respectively.
 */
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Cloudflare } from "cloudflare";
import z from "zod/v4";
import { DnsProvidersRepository } from "../../shared/repositories/dns-providers.repository";
import { toCloudflareErrorMessage } from "./cloudflare.helpers";

import { AppError } from "@repo/errors";
type DnsProviderRow = typeof import("@/config/drizzle/global/schema").dnsProviders.$inferSelect;
export type DnsProviderRuntimeState = import("@/config/drizzle/global/schema").DnsProviderRuntimeState;
export type DnsProviderFeatures = import("@/config/drizzle/global/schema").DnsProviderFeatures;

const cloudflareCredentialsSchema = z.object({
    apiToken: z.string().min(1),
    accountEmail: z.string().optional(),
});
export type CloudflareCredentials = z.infer<typeof cloudflareCredentialsSchema>;

const featuresSchema = z.object({
    dnsManagement: z.boolean().default(true),
    tunnelManagement: z.boolean().default(false),
});

export interface DnsProviderAppView {
    id: string;
    name: string;
    providerType: string;
    isActive: boolean;
    features: DnsProviderFeatures;
    state: DnsProviderRuntimeState | null;
    createdAt: string;
    updatedAt: string;
}

const STATE_TTL_MS = 15_000;

@Injectable()
export class CloudflareAppService {
    private readonly logger = new Logger(CloudflareAppService.name);

    /** In-memory TTL cache of the last live state check (never authoritative). */
    private readonly stateCache = new Map<string, { at: number; state: DnsProviderRuntimeState }>();

    constructor(private readonly dnsProvidersRepository: DnsProvidersRepository) {}

    // ─── Row access ──────────────────────────────────────────────────────────

    getRow(providerId: string): Promise<DnsProviderRow | null> {
        return this.dnsProvidersRepository.findById(providerId);
    }

    // ─── App CRUD ────────────────────────────────────────────────────────────

    async listApps(providerType?: string): Promise<DnsProviderAppView[]> {
        const rows = await this.dnsProvidersRepository.list(providerType);
        const views = rows.map((r) => this.toView(r));
        // Live state for each app (parallel, TTL-cached) — runtime check, not DB.
        return Promise.all(views.map(async (v) => ({ ...v, state: await this.getLiveState(v.id) })));
    }

    async getAppView(providerId: string): Promise<DnsProviderAppView | null> {
        const row = await this.getRow(providerId);
        if (!row) return null;
        return { ...this.toView(row), state: await this.getLiveState(providerId) };
    }

    async createApp(input: {
        name: string;
        providerType: string;
        apiToken: string;
        accountEmail?: string;
        features?: Partial<DnsProviderFeatures>;
    }): Promise<DnsProviderAppView> {
        // Only the implemented provider may be created. The UI may still offer
        // route53/google-dns/etc. rows in legacy forms — those must NEVER be
        // persisted with Cloudflare credentials (credential-smuggling CF-2).
        if (input.providerType !== "cloudflare") {
            throw new BadRequestException(
                `DNS provider '${input.providerType}' is not supported yet — only 'cloudflare' is available`,
            );
        }

        // Verify the token at runtime BEFORE persisting anything.
        const client = new Cloudflare({ apiToken: input.apiToken });
        try {
            const verify = await client.user.tokens.verify();
            if (verify.status !== "active") {
                throw new BadRequestException(`Token status is "${verify.status}" — expected "active"`);
            }
        } catch (err) {
            if (err instanceof BadRequestException) throw err;
            throw new BadRequestException(
                `Invalid Cloudflare API token: ${err instanceof Error ? err.message : "verification failed"}`,
                { cause: err },
            );
        }

        const credentials = JSON.stringify({
            apiToken: input.apiToken,
            ...(input.accountEmail ? { accountEmail: input.accountEmail } : {}),
        });
        const features = featuresSchema.parse({ dnsManagement: true, tunnelManagement: false, ...input.features });

        const row = await this.dnsProvidersRepository.create({
            providerType: input.providerType,
            name: input.name,
            isActive: true,
            credentials,
            config: { accountId: null },
            features,
            state: null,
        });
        if (!row) throw new AppError("Failed to create DNS provider", "INTERNAL_ERROR");
        this.logger.log(`DNS provider "${input.name}" created (${input.providerType})`);

        const view = this.toView(row);
        view.state = await this.getLiveState(row.id, true);
        return view;
    }

    async updateApp(
        providerId: string,
        input: { name?: string; isActive?: boolean; features?: Partial<DnsProviderFeatures> },
    ): Promise<DnsProviderAppView> {
        const existing = await this.getRow(providerId);
        if (!existing) throw new NotFoundException(`DNS provider not found: ${providerId}`);

        const features = input.features
            ? featuresSchema.parse({ ...existing.features, ...input.features })
            : undefined;

        const row = await this.dnsProvidersRepository.updateById(providerId, {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            ...(features ? { features } : {}),
        });
        if (!row) throw new NotFoundException(`DNS provider not found: ${providerId}`);
        this.stateCache.delete(providerId);
        return { ...this.toView(row), state: await this.getLiveState(providerId, true) };
    }

    async deleteApp(providerId: string): Promise<boolean> {
        // Guard: an app backing a node tunnel cannot be deleted while in use.
        const ref = await this.dnsProvidersRepository.findTunnelOwnerNode(providerId);
        if (ref) {
            throw new ConflictException(
                `Cannot delete: this provider is the tunnel owner of node ${ref.nodeId}. Remove the tunnel binding in System → Node Network first.`,
            );
        }
        await this.dnsProvidersRepository.deleteById(providerId);
        this.stateCache.delete(providerId);
        this.logger.log(`DNS provider ${providerId} deleted`);
        return true;
    }

    // ─── Credentials & client ────────────────────────────────────────────────

    parseCredentials(raw: string): CloudflareCredentials | null {
        try {
            const parsed = cloudflareCredentialsSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    async getCredentials(providerId: string): Promise<CloudflareCredentials> {
        const row = await this.getRow(providerId);
        if (!row) throw new NotFoundException(`DNS provider not found: ${providerId}`);
        if (!row.isActive) throw new BadRequestException(`DNS provider is inactive: ${providerId}`);
        const creds = this.parseCredentials(row.credentials);
        if (!creds) throw new BadRequestException(`DNS provider has no valid API token: ${providerId}`);
        return creds;
    }

    async buildClient(providerId: string): Promise<Cloudflare> {
        const creds = await this.getCredentials(providerId);
        return new Cloudflare({ apiToken: creds.apiToken });
    }

    /**
     * Resolve the Cloudflare account id for a provider, persisting it into
     * `config.accountId` so tunnel calls don't re-resolve every time.
     */
    async getOrResolveAccountId(providerId: string): Promise<string> {
        const row = await this.getRow(providerId);
        const stored = row?.config?.accountId;
        if (stored) return stored;

        const client = await this.buildClient(providerId);
        const accountId = await this.resolveAccountId(client);
        if (!accountId) {
            throw new BadRequestException(
                `Could not resolve a Cloudflare account for this token. Grant "Account:Read" or "Zone:Read" permission to the API token.`,
            );
        }
        await this.updateConfig(providerId, { accountId });
        return accountId;
    }

    private async resolveAccountId(client: Cloudflare): Promise<string | null> {
        try {
            const page = await client.accounts.list({ per_page: 1 });
            const id = page.result[0]?.id;
            if (id) return id;
        } catch {
            // fall through to zone-based resolution
        }
        try {
            const page = await client.zones.list({ per_page: 1 });
            const id = page.result[0]?.account?.id;
            if (id) return id;
        } catch {
            // fall through
        }
        return null;
    }

    private async updateConfig(providerId: string, config: { accountId?: string | null }): Promise<void> {
        const row = await this.getRow(providerId);
        await this.dnsProvidersRepository.updateById(providerId, {
            config: { ...row?.config, ...config },
        });
    }

    // ─── Runtime state ───────────────────────────────────────────────────────

    /**
     * Live runtime state of a provider app. TTL-cached in memory (15s) so
     * dashboards don't hammer the Cloudflare API; `force` skips the cache.
     */
    async getLiveState(providerId: string, force = false): Promise<DnsProviderRuntimeState> {
        const cached = this.stateCache.get(providerId);
        if (!force && cached && Date.now() - cached.at < STATE_TTL_MS) {
            return cached.state;
        }
        const state = await this.checkStateLive(providerId);
        this.stateCache.set(providerId, { at: Date.now(), state });
        // Persist as display cache only (never authoritative).
        try {
            await this.dnsProvidersRepository.updateById(providerId, { state });
        } catch {
            // cache write failure is non-fatal
        }
        return state;
    }

    private async checkStateLive(providerId: string): Promise<DnsProviderRuntimeState> {
        try {
            const client = await this.buildClient(providerId);
            const verify = await client.user.tokens.verify();
            const accountId = await this.resolveAccountId(client);
            const checkedAt = new Date().toISOString();
            if (verify.status !== "active") {
                return {
                    status: "error",
                    checkedAt,
                    accountId,
                    tokenValid: false,
                    error: `Token status is "${verify.status}"`,
                };
            }
            return { status: "ok", checkedAt, accountId, tokenValid: true, error: null };
        } catch (err) {
            return {
                status: "error",
                checkedAt: new Date().toISOString(),
                accountId: null,
                tokenValid: false,
                error: toCloudflareErrorMessage(err),
            };
        }
    }

    /**
     * Apps that can back a node tunnel: active, tunnelManagement enabled and
     * runtime state healthy.
     */
    async listTunnelCapableApps(): Promise<DnsProviderAppView[]> {
        const views = await this.listApps("cloudflare");
        return views.filter((v) => v.isActive && v.features.tunnelManagement && v.state?.status === "ok");
    }

    // ─── View mapping ────────────────────────────────────────────────────────

    private toView(row: DnsProviderRow): DnsProviderAppView {
        const features = featuresSchema.parse(row.features ?? {});
        return {
            id: row.id,
            name: row.name,
            providerType: row.providerType,
            isActive: row.isActive,
            features,
            state: row.state,
            createdAt: row.createdAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
        };
    }
}
