/**
 * Domain Routing Service
 *
 * Bridges the domain module (service_domain_mappings) and the Traefik routing
 * engine. A service's reachable URLs are derived ENTIRELY from its domain
 * mappings (provider-scoped org domains + subdomain + basePath) — never from
 * environment variables.
 *
 * Responsibilities:
 *  - resolveServiceUrls: map a service's bindings → structured reachable URLs
 *  - resolvePrimaryUrl: the primary URL for a deployment (domainUrl)
 *  - syncServiceRoutes: upsert traefik service config + domain routes from the
 *    mappings and sync them to the filesystem (replaces the localhost fallback)
 *
 * G1: traefik template variables (`~##domain##~`, `~##subdomain##~`, …) are
 * resolved from the mapping-derived context via TraefikVariableResolverService.
 */
import { Injectable, Logger } from "@nestjs/common";
import { ServiceDomainMappingRepository } from "../repositories/service-domain-mapping.repository";
import { TraefikRepository } from "@/core/modules/traefik/repositories/traefik.repository";
import { TraefikService } from "@/core/modules/traefik/services/traefik.service";
import { TraefikSyncService } from "@/core/modules/traefik/services/traefik-sync.service";
import { TraefikVariableResolverService } from "@/core/modules/traefik/services/traefik-variable-resolver.service";

import { AppError } from "@repo/errors";
export interface ResolvedServiceUrl {
    mappingId: string;
    /** hostname only, e.g. "api.example.com" or "example.com" */
    host: string;
    /** base domain, e.g. "example.com" */
    domain: string;
    /** subdomain label, e.g. "api", or null for root */
    subdomain: string | null;
    /** URL path prefix, e.g. "/v1", or null */
    basePath: string | null;
    /** full URL, e.g. "https://api.example.com/v1" */
    fullUrl: string;
    isPrimary: boolean;
    sslEnabled: boolean;
    sslProvider: "letsencrypt" | "custom" | "none";
}

export interface RouteSyncResult {
    success: boolean;
    reason?: string;
    urls: ResolvedServiceUrl[];
    primaryUrl: string | null;
    configId?: string;
}

@Injectable()
export class DomainRoutingService {
    private readonly logger = new Logger(DomainRoutingService.name);

    constructor(
        private readonly serviceDomainMappingRepository: ServiceDomainMappingRepository,
        private readonly traefikRepository: TraefikRepository,
        private readonly traefikService: TraefikService,
        private readonly traefikSyncService: TraefikSyncService,
        private readonly traefikVariableResolverService: TraefikVariableResolverService,
    ) {}

    // ─── URL resolution ──────────────────────────────────────────────────────

    /**
     * Resolve every reachable URL for a service from its domain mappings.
     * Pure read — no side effects. No env vars involved.
     */
    async resolveServiceUrls(serviceId: string): Promise<ResolvedServiceUrl[]> {
        const rows = await this.serviceDomainMappingRepository.findServiceUrlRows(serviceId);

        return rows.map((row) => {
            const subdomain = row.subdomain && row.subdomain.trim() ? row.subdomain.trim() : null;
            const basePath = row.basePath && row.basePath.trim() ? this.normalizeBasePath(row.basePath) : null;
            const host = subdomain ? `${subdomain}.${row.orgDomain}` : row.orgDomain;
            const fullUrl = `https://${host}${basePath ?? ""}`;
            const sslEnabled = row.sslEnabled !== false;
            const sslProvider: ResolvedServiceUrl["sslProvider"] = row.sslProvider === "custom" || row.sslProvider === "none"
                ? row.sslProvider
                : "letsencrypt";
            return {
                mappingId: row.mappingId,
                host,
                domain: row.orgDomain,
                subdomain,
                basePath,
                fullUrl,
                isPrimary: row.isPrimary,
                sslEnabled,
                sslProvider,
            };
        });
    }

    /**
     * The primary reachable URL (isPrimary mapping, else the first). Null when
     * the service has no domain mappings.
     */
    async resolvePrimaryUrl(serviceId: string): Promise<string | null> {
        const urls = await this.resolveServiceUrls(serviceId);
        if (urls.length === 0) {
            return null;
        }
        const primary = urls.find((u) => u.isPrimary) ?? urls[0];
        return primary?.fullUrl ?? null;
    }

    /**
     * Resolve traefik template variables (`~##domain##~`, `~##subdomain##~`,
     * `~##fullDomain##~`, `~##pathPrefix##~`, …) for a service's primary URL
     * context. Returns the raw → resolved map for G1.
     */
    buildVariableMap(serviceId: string, primary: ResolvedServiceUrl | null, options?: { pathPrefix?: string | null; healthCheckPath?: string | null }): Record<string, string> {
        return this.traefikVariableResolverService.buildVariableMap({
            domain: primary
                ? {
                      domain: primary.domain,
                      subdomain: primary.subdomain ?? undefined,
                      fullDomain: primary.host,
                      baseDomain: primary.domain,
                  }
                : undefined,
            path: {
                prefix: options?.pathPrefix ?? primary?.basePath ?? undefined,
                healthCheck: options?.healthCheckPath ?? "/health",
            },
        });
    }

    // ─── Route sync (A1) ─────────────────────────────────────────────────────

    /**
     * Upsert the traefik service config + domain routes for a service from its
     * domain mappings, then sync to the filesystem. Idempotent.
     *
     * `options.port` / `options.healthCheckPath` come from the caller's
     * service config (data, never env vars).
     */
    async syncServiceRoutes(
        serviceId: string,
        options?: { port?: number; healthCheckPath?: string | null },
    ): Promise<RouteSyncResult> {
        const urls = await this.resolveServiceUrls(serviceId);

        if (urls.length === 0) {
            return { success: false, reason: "no_domain_mappings", urls: [], primaryUrl: null };
        }

        const primary = urls.find((u) => u.isPrimary) ?? urls[0]!;
        const port = options?.port ?? 80;

        // Find or create the traefik service config (unique per serviceId).
        let config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        if (!config) {
            await this.traefikRepository.createServiceConfig({
                serviceId,
                domain: primary.domain,
                subdomain: primary.subdomain ?? undefined,
                port,
                sslEnabled: primary.sslEnabled,
                sslProvider: primary.sslProvider === "none" ? undefined : (primary.sslProvider as "letsencrypt" | "custom"),
                pathPrefix: primary.basePath ?? "/",
                healthCheck: {
                    enabled: true,
                    path: options?.healthCheckPath ?? "/health",
                },
                isActive: true,
            });
            config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
            if (!config) {
                throw new AppError(`Failed to create traefik config for service ${serviceId}`, `INTERNAL_ERROR`);
            }
        } else {
            await this.traefikRepository.updateServiceConfig({
                id: config.id,
                domain: primary.domain,
                subdomain: primary.subdomain ?? undefined,
                fullDomain: primary.host,
                port,
                sslEnabled: primary.sslEnabled,
                sslProvider: primary.sslProvider === "none" ? undefined : (primary.sslProvider as "letsencrypt" | "custom"),
                pathPrefix: primary.basePath ?? "/",
                healthCheck: {
                    enabled: true,
                    path: options?.healthCheckPath ?? "/health",
                },
                isActive: true,
            });
        }

        const configId = config.id;

        // Existing routes, keyed by host rule for upsert.
        const existingRoutes = await this.traefikRepository.getDomainRoutesByConfigId(configId, undefined);
        const existingByHost = new Map<string, { id: string; hostRule: string }>();
        for (const route of existingRoutes) {
            const host = this.extractHostFromRule(route.hostRule);
            if (host) {
                existingByHost.set(host, route);
            }
        }

        // Create/update routes for each mapping.
        const seenHosts = new Set<string>();
        for (const url of urls) {
            const hostRule = `Host(\`${url.host}\`)`;
            const pathRule = url.basePath ? `PathPrefix(\`${url.basePath}\`)` : undefined;
            const entryPoint = url.sslEnabled ? "websecure" : "web";
            const priority = url.isPrimary ? 100 : 10;

            const existing = existingByHost.get(url.host);
            if (existing) {
                await this.traefikRepository.updateDomainRoute(existing.id, {
                    hostRule,
                    pathRule,
                    entryPoint,
                    priority,
                    isActive: true,
                });
            } else {
                await this.traefikRepository.createDomainRoute({
                    configId,
                    hostRule,
                    pathRule,
                    entryPoint,
                    priority,
                    isActive: true,
                });
            }
            seenHosts.add(url.host);
        }

        // Deactivate routes whose host is no longer mapped.
        for (const [host, route] of existingByHost) {
            if (!seenHosts.has(host)) {
                await this.traefikRepository.updateDomainRoute(route.id, { isActive: false });
            }
        }

        // Resolve G1 variables for the config content and sync.
        const variableMap = this.buildVariableMap(serviceId, primary, {
            pathPrefix: primary.basePath,
            healthCheckPath: options?.healthCheckPath,
        });
        this.logger.log(`Domain routes synced for service ${serviceId} (${String(urls.length)} mappings, ${String(Object.keys(variableMap).length)} variables resolved)`);

        await this.traefikSyncService.syncServiceConfiguration(configId);

        return {
            success: true,
            urls,
            primaryUrl: primary.fullUrl,
            configId,
        };
    }

    /**
     * A5: TLS certificate executor. When the primary mapping has SSL enabled,
     * registers an SSL certificate record for its host with the Traefik
     * certificate store (LetsEncrypt by default, `custom` when the mapping
     * uses a custom provider). Idempotent — existing cert for the host is
     * left untouched. Data-driven (mapping ssl fields), never env vars.
     */
    async provisionTlsCertificate(serviceId: string): Promise<{ provisioned: boolean; host: string | null; reason?: string }> {
        const urls = await this.resolveServiceUrls(serviceId);
        const primary = urls.find((u) => u.isPrimary) ?? urls[0];
        if (!primary) {
            return { provisioned: false, host: null, reason: "no_domain_mapping" };
        }
        if (!primary.sslEnabled || primary.sslProvider === "none") {
            return { provisioned: false, host: primary.host, reason: "ssl_disabled" };
        }

        const config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        if (!config) {
            return { provisioned: false, host: primary.host, reason: "no_traefik_config" };
        }

        // Idempotency: skip if a cert for this host already exists.
        const existingCerts = await this.traefikRepository.getSSLCertificatesByConfigId(config.id, undefined);
        if (existingCerts.some((cert) => cert.domain === primary.host)) {
            return { provisioned: true, host: primary.host, reason: "already_provisioned" };
        }

        await this.traefikService.addSSLCertificate(config.id, {
            domain: primary.host,
            subjectAltNames: primary.subdomain ? [primary.domain] : undefined,
            issuer: primary.sslProvider === "custom" ? "custom" : "letsencrypt",
            autoRenew: primary.sslProvider !== "custom",
            renewalThreshold: 30,
            isActive: true,
        });

        this.logger.log(`TLS certificate provisioned for ${primary.host} (provider=${primary.sslProvider})`);
        return { provisioned: true, host: primary.host };
    }

    // ─── Preview routes (B1) ────────────────────────────────────────────────

    /**
     * Add a temporary preview route (e.g. `pr-12.example.com`) to the
     * service's traefik config WITHOUT touching the mapped stable routes.
     * No-op when the service has no config yet (stable sync will create it).
     */
    async addPreviewRoute(serviceId: string, host: string, options?: { sslEnabled?: boolean }): Promise<{ configId: string; routeId: string } | null> {
        const config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        if (!config) {
            // Stable routes not yet synced; create a minimal config so the
            // preview route has a home. domain is host up to first dot.
            const domain = host.includes(".") ? host.split(".").slice(-2).join(".") : host;
            const subdomain = host.includes(".") ? host.split(".").slice(0, -2).join(".") : undefined;
            const created = await this.traefikRepository.createServiceConfig({
                serviceId,
                domain,
                subdomain,
                port: 80,
                sslEnabled: options?.sslEnabled ?? true,
                sslProvider: "letsencrypt",
                pathPrefix: "/",
                isActive: true,
            });
            if (!created) {
                return null;
            }
        }

        const refreshed = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        if (!refreshed) {
            return null;
        }

        const hostRule = `Host(\`${host}\`)`;
        const existingRoutes = await this.traefikRepository.getDomainRoutesByConfigId(refreshed.id, undefined);
        const existing = existingRoutes.find((r) => this.extractHostFromRule(r.hostRule) === host);
        if (existing) {
            await this.traefikRepository.updateDomainRoute(existing.id, { isActive: true, entryPoint: "websecure", priority: 50 });
            return { configId: refreshed.id, routeId: existing.id };
        }

        const created = await this.traefikRepository.createDomainRoute({
            configId: refreshed.id,
            hostRule,
            entryPoint: "websecure",
            priority: 50,
            isActive: true,
        });
        return created ? { configId: refreshed.id, routeId: created.id } : null;
    }

    /**
     * Deactivate a preview route for a host (preview cleanup).
     */
    async removePreviewRoute(serviceId: string, host: string): Promise<boolean> {
        const config = await this.traefikRepository.getServiceConfigByServiceId(serviceId);
        if (!config) {
            return false;
        }
        const routes = await this.traefikRepository.getDomainRoutesByConfigId(config.id, undefined);
        const target = routes.find((r) => this.extractHostFromRule(r.hostRule) === host);
        if (!target) {
            return false;
        }
        await this.traefikRepository.updateDomainRoute(target.id, { isActive: false });
        return true;
    }

    /**
     * B5: promote a preview to a stable domain mapping. Creates a permanent
     * `service_domain_mappings` row (subdomain = preview name, on the primary
     * mapping's project domain) and re-syncs routes so the host becomes a
     * stable route that survives preview TTL cleanup. Idempotent — no-op when
     * a stable mapping for the same subdomain already exists.
     */
    async promotePreviewToStable(serviceId: string, previewName: string): Promise<{ promoted: boolean; host: string | null; reason?: string; mappingId?: string }> {
        const urls = await this.resolveServiceUrls(serviceId);
        const primary = urls.find((u) => u.isPrimary) ?? urls[0];
        if (!primary) {
            return { promoted: false, host: null, reason: "no_domain_mapping" };
        }

        const host = `${previewName}.${primary.domain}`;

        // Re-fetch primary mapping's projectDomainId (resolveServiceUrls doesn't carry it).
        const primaryProjectDomainId = await this.serviceDomainMappingRepository
            .findProjectDomainIdByMappingId(primary.mappingId);
        if (!primaryProjectDomainId) {
            return { promoted: false, host, reason: "primary_mapping_missing" };
        }

        // Skip if this exact subdomain already has a stable mapping on the same project domain.
        const duplicates = await this.serviceDomainMappingRepository.findBySubdomain(
            primaryProjectDomainId,
            previewName,
        );
        if (duplicates.length > 0) {
            return { promoted: false, host, reason: "subdomain_already_stable" };
        }

        const created = await this.serviceDomainMappingRepository.create({
            serviceId,
            projectDomainId: primaryProjectDomainId,
            subdomain: previewName,
            basePath: null,
            isPrimary: false,
            sslEnabled: true,
            sslProvider: "letsencrypt",
        });

        if (!created) {
            return { promoted: false, host, reason: "insert_failed" };
        }

        // Re-sync routes so the promoted host gets a stable route (and the
        // preview route for it is superseded by the mapping-derived route).
        await this.syncServiceRoutes(serviceId, { healthCheckPath: "/health" });

        // Mark any matching preview_environments rows inactive (promoted).
        await this.serviceDomainMappingRepository.deactivatePreviewEnvironmentsByFullDomain(host);

        this.logger.log(`Preview promoted to stable mapping: ${host} (service=${serviceId})`);
        return { promoted: true, host, mappingId: created.id };
    }


    // ─── Helpers ─────────────────────────────────────────────────────────────

    private normalizeBasePath(basePath: string): string {
        const trimmed = basePath.trim();
        if (!trimmed || trimmed === "/") {
            return "";
        }
        return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
    }

    private extractHostFromRule(hostRule: string): string | null {
        const match = /^Host\(`(.+)`\)$/.exec(hostRule.trim());
        return match?.[1] ?? null;
    }
}
