/**
 * Preview Provisioning Service
 *
 * Makes preview deployments actually reachable. Called by the GitHub webhook
 * dispatch after a preview lifecycle decision:
 *
 *  1. Resolve the preview host from the service's PRIMARY domain mapping
 *     (e.g. `pr-123.example.com` where `example.com` is a provider-owned org
 *     domain). Fully data-driven — no `.local` placeholder, no env vars.
 *  2. If a DNS provider account covers the host's zone, create the DNS record
 *     (CNAME → tunnel hostname, or A → public IP) from the node network config.
 *  3. Add a temporary Traefik route for the preview host (stable mappings
 *     untouched).
 *  4. Record the preview in `preview_environments` when a matching deployment
 *     exists (the FK requires a deploymentId).
 *
 * Cleanup deactivates the route, removes the DNS record, and marks the row
 * inactive.
 */
import { Injectable, Logger } from "@nestjs/common";
import { isIP } from "node:net";
import { ReachabilityService } from "@/core/modules/reachability/services/reachability.service";
import { PublicAccessPointService } from "@/core/modules/reachability/services/public-access-point.service";
import { DomainRoutingService } from "@/core/modules/domain/services/domain-routing.service";
import { CloudflareDnsProviderService } from "@/modules/providers/dns/cloudflare/services/cloudflare-dns-provider.service";
import { PreviewEnvironmentRepository } from "../repositories/preview-environment.repository";

export interface PreviewProvisionInput {
    serviceId: string;
    previewName: string;
    branchName?: string | null;
    prNumber?: number | null;
    commitSha?: string | null;
    pullRequestUrl?: string | null;
    trigger?: "merge" | "close" | "ttl_expired";
    reason?: string;
    deliveryId: string;
}

export interface PreviewProvisionResult {
    action: "provisioned" | "cleaned" | "skipped";
    reason: string;
    host: string | null;
    dnsRecord: { name: string; type: string; content: string } | null;
    routeApplied: boolean;
    recorded: boolean;
}

const PREVIEW_TTL_MS = 168 * 60 * 60 * 1000; // 7 days, matches cleanup policy ttlHours: 168

@Injectable()
export class PreviewProvisioningService {
    private readonly logger = new Logger(PreviewProvisioningService.name);

    constructor(
        private readonly previewEnvironmentRepository: PreviewEnvironmentRepository,
        private readonly reachabilityService: ReachabilityService,
        private readonly domainRoutingService: DomainRoutingService,
        private readonly dnsProvidersService: CloudflareDnsProviderService,
        private readonly publicAccessPointService: PublicAccessPointService,
    ) {}

    async provisionPreview(input: PreviewProvisionInput): Promise<PreviewProvisionResult> {
        // 1. Resolve the preview host from the service's primary domain mapping.
        const urls = await this.domainRoutingService.resolveServiceUrls(input.serviceId);
        const primary = urls.find((u) => u.isPrimary) ?? urls[0];
        if (!primary) {
            return {
                action: "skipped",
                reason: "no_domain_mapping",
                host: null,
                dnsRecord: null,
                routeApplied: false,
                recorded: false,
            };
        }

        const host = `${input.previewName}.${primary.domain}`;

        // 2. DNS record (only when a provider covers the host's zone).
        let dnsRecord: { name: string; type: string; content: string } | null = null;
        let providerId: string | null = null;
        try {
            const provider = await this.dnsProvidersService.findFirstActiveProvider();
            if (provider) {
                providerId = provider.providerId;
                const zone = await this.dnsProvidersService.findZoneForHostname(provider, host);
                if (zone) {
                    const target = await this.resolveDnsTarget();
                    if (target) {
                        const created = await this.dnsProvidersService.createRecord(provider, {
                            zoneId: zone.zoneId,
                            type: target.kind === "hostname" ? "CNAME" : "A",
                            name: host,
                            content: target.value,
                            ttl: 1,
                            proxied: true,
                        });
                        dnsRecord = { name: created.name, type: created.type, content: created.content };
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`Preview DNS provisioning skipped for ${host}: ${error instanceof Error ? error.message : String(error)}`);
        }

        // 3. Temporary Traefik route.
        let routeApplied = false;
        try {
            const route = await this.domainRoutingService.addPreviewRoute(input.serviceId, host, { sslEnabled: true });
            routeApplied = route !== null;
        } catch (error) {
            this.logger.warn(`Preview route provisioning skipped for ${host}: ${error instanceof Error ? error.message : String(error)}`);
        }

        // 4. Record the preview row when a matching deployment exists.
        const recorded = await this.recordPreviewRow(input, host);

        this.logger.log(`Preview provisioned: ${host} (dns=${dnsRecord ? "yes" : "no"}, route=${String(routeApplied)}, recorded=${String(recorded)})`);
        return {
            action: "provisioned",
            reason: "preview_provisioned",
            host,
            dnsRecord,
            routeApplied,
            recorded,
        };
    }

    async cleanupPreview(input: PreviewProvisionInput): Promise<PreviewProvisionResult> {
        const urls = await this.domainRoutingService.resolveServiceUrls(input.serviceId);
        const primary = urls.find((u) => u.isPrimary) ?? urls[0];
        if (!primary) {
            return { action: "skipped", reason: "no_domain_mapping", host: null, dnsRecord: null, routeApplied: false, recorded: false };
        }

        const host = `${input.previewName}.${primary.domain}`;

        // Deactivate the route.
        let routeApplied = false;
        try {
            routeApplied = await this.domainRoutingService.removePreviewRoute(input.serviceId, host);
        } catch (error) {
            this.logger.warn(`Preview route cleanup failed for ${host}: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Remove the DNS record if a provider covers the zone.
        let dnsRecord: { name: string; type: string; content: string } | null = null;
        try {
            const provider = await this.dnsProvidersService.findFirstActiveProvider();
            if (provider) {
                const zone = await this.dnsProvidersService.findZoneForHostname(provider, host);
                if (zone) {
                    const records = await this.dnsProvidersService.listRecords(provider, zone.zoneId);
                    const target = records.find((r) => r.name === host);
                    if (target) {
                        dnsRecord = { name: target.name, type: target.type, content: target.content };
                        await this.dnsProvidersService.deleteRecord(provider, zone.zoneId, target.id);
                    }
                }
            }
        } catch (error) {
            this.logger.warn(`Preview DNS lookup during cleanup failed for ${host}: ${error instanceof Error ? error.message : String(error)}`);
        }

        // Mark any matching preview rows inactive.
        await this.previewEnvironmentRepository.deactivateByFullDomain(host);

        this.logger.log(`Preview cleaned: ${host} (route=${String(routeApplied)})`);
        return {
            action: "cleaned",
            reason: input.reason ?? "preview_cleaned",
            host,
            dnsRecord,
            routeApplied,
            recorded: false,
        };
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    /**
     * Deactivate an expired preview row (TTL scheduler). Deactivates the
     * traefik route + removes the DNS record (same cleanup as PR close).
     */
    async expirePreview(previewId: string, serviceId: string, previewName: string, fullDomain: string): Promise<PreviewProvisionResult> {
        // Reuse the same cleanup path (route + DNS record + row inactive).
        const result = await this.cleanupPreview({
            serviceId,
            previewName,
            trigger: "ttl_expired",
            reason: "preview_ttl_expired",
            deliveryId: `ttl-${previewId}`,
        });
        return result;
    }

    /**
     * Active preview environments that have expired (expiresAt < now).
     * Used by the TTL cleanup scheduler.
     */
    async findExpiredPreviews(now: Date = new Date()): Promise<Array<{ id: string; serviceId: string; previewName: string; fullDomain: string }>> {
        const rows = await this.previewEnvironmentRepository.findExpired(now);

        return rows.map((r) => ({
            id: r.id,
            serviceId: r.serviceId,
            previewName: r.subdomain,
            fullDomain: r.fullDomain,
        }));
    }

    /**
     * Resolve the DNS target for preview records from the node's PUBLIC ACCESS
     * POINT (global relay): tunnel hostname first (CNAME), else the configured
     * address — which may be an IP (A/AAAA) or a hostname (CNAME), detected
     * with node:net isIP. Never from env vars.
     */
    private async resolveDnsTarget(): Promise<{ kind: "hostname" | "ip"; value: string } | null> {
        const accessPoint = await this.publicAccessPointService.getAccessPoint();
        if (accessPoint.kind === "tunnel" && accessPoint.address) {
            return { kind: "hostname", value: accessPoint.address };
        }
        if (accessPoint.configured && accessPoint.address) {
            const address = accessPoint.address.trim();
            if (!address) return null;
            return isIP(address.split("/")[0]!) === 0
                ? { kind: "hostname", value: address }
                : { kind: "ip", value: address };
        }
        return null;
    }

    private async recordPreviewRow(input: PreviewProvisionInput, host: string): Promise<boolean> {
        if (input.prNumber == null) {
            return false;
        }

        // Find a deployment for this service whose source config matches the PR.
        const deployment = await this.previewEnvironmentRepository.findLatestDeploymentByService(input.serviceId);
        if (!deployment) {
            return false;
        }

        await this.previewEnvironmentRepository.upsertPreview({
            deploymentId: deployment.id,
            subdomain: input.previewName,
            fullDomain: host,
            branchName: input.branchName ?? undefined,
            pullRequestUrl: input.pullRequestUrl ?? undefined,
        });

        return true;
    }
}
