import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import z from "zod/v4";
import {
    defaultProjectNetworkConfig,
    projectNetworkConfigSchema,
    type ProjectNetworkConfig,
} from "@repo/contracts-entities";
import type { ProjectNetworkView, ProjectUpdateNetworkInput } from "@repo/api-contracts";
import { CloudflareAppService } from "@/modules/providers/dns/cloudflare/services/cloudflare-app.service";
import { CloudflareDnsProviderService } from "@/modules/providers/dns/cloudflare/services/cloudflare-dns-provider.service";
import { ProjectDomainRepository } from "@/core/modules/domain/repositories/project-domain.repository";
import { ProjectRepository } from "../repositories/project.repository";

/** Validate a provider record type against the contract's full enum. */
const recordTypeSchema = z.enum([
    "A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC", "MX", "NAPTR", "NS", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SVCB", "TLSA", "TXT", "URI",
] as const);

const mapRecord = (r: {
    id: string; zoneId: string; name: string; type: string; content: string; ttl: number; proxied: boolean;
}): ProjectNetworkView["records"][number] => ({
    id: r.id,
    zoneId: r.zoneId,
    name: r.name,
    type: recordTypeSchema.safeParse(r.type).success ? recordTypeSchema.parse(r.type) : "TXT",
    content: r.content,
    ttl: r.ttl,
    proxied: r.proxied,
});

/**
 * Project Network Service — provider-backed network configuration.
 *
 * A project anchors its networking to ONE DNS provider account + ONE zone.
 * The zone name becomes the project's base domain. This service:
 * - Reads/writes the project `network` config (persisted in projects.network).
 * - Discovers available DNS providers + their zones + zone records (live).
 * - Lists existing org domains + project domains (candidates for base domain).
 */
@Injectable()
export class ProjectNetworkService {
    private readonly logger = new Logger(ProjectNetworkService.name);

    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly appService: CloudflareAppService,
        private readonly dnsService: CloudflareDnsProviderService,
        private readonly projectDomainRepository: ProjectDomainRepository,
    ) {}

    /**
     * Build the network view for a project: config + provider discovery.
     * Zones/records are fetched LIVE from the selected provider when the
     * project has a network config with a provider pinned.
     */
    async getNetwork(projectId: string): Promise<ProjectNetworkView> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new NotFoundException(`Project not found: ${projectId}`);
        }

        const network = project.network
            ? projectNetworkConfigSchema.safeParse(project.network).data ?? null
            : null;

        const providers = await this.appService.listApps();

        let zones: ProjectNetworkView["zones"] = [];
        let records: ProjectNetworkView["records"] = [];

        if (network?.dnsProviderId && network.zoneId) {
            try {
                const account = { providerId: network.dnsProviderId, providerType: "cloudflare" };
                const providerZones = await this.dnsService.listZones(account);
                zones = providerZones.map((z) => ({
                    id: z.id,
                    name: z.name,
                    status: z.status,
                    nameServers: z.nameServers,
                }));
                const providerRecords = await this.dnsService.listRecords(account, network.zoneId);
                records = providerRecords.map(mapRecord);
            } catch (err) {
                this.logger.warn(`Failed to fetch zones/records for project ${projectId}: ${(err as Error).message}`);
            }
        }

        // This project's verified domains (direct-domain model — candidates for base domain).
        const projectDomainsRaw = await this.projectDomainRepository.findByProjectId(projectId);
        const orgDomains = projectDomainsRaw
            .filter((d) => d.verificationStatus === "verified")
            .map((d) => ({
                id: d.id,
                domain: d.domain,
                verificationStatus: d.verificationStatus,
                verifiedAt: d.verifiedAt ? new Date(d.verifiedAt).toISOString() : null,
            }));
        const projectDomains = projectDomainsRaw.map((pd) => ({
            id: pd.id,
            domain: pd.domain,
            allowedSubdomains: pd.allowedSubdomains,
            isPrimary: pd.isPrimary,
        }));

        return {
            network,
            providers: providers.map((p) => ({
                id: p.id,
                name: p.name,
                providerType: p.providerType,
                isActive: p.isActive,
                features: p.features,
                state: p.state
                    ? {
                          status: p.state.status,
                          checkedAt: p.state.checkedAt,
                          accountId: p.state.accountId,
                          tokenValid: p.state.tokenValid,
                          error: p.state.error,
                      }
                    : null,
            })),
            zones,
            records,
            projectDomains,
        };
    }

    /**
     * Update the project network config. When `dnsProviderId`/`zoneId` change,
     * the zone name becomes the project's base domain (kept in sync).
     */
    async updateNetwork(projectId: string, input: Record<string, unknown>): Promise<ProjectNetworkView> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new NotFoundException(`Project not found: ${projectId}`);
        }

        const current = project.network
            ? projectNetworkConfigSchema.safeParse(project.network).data ?? defaultProjectNetworkConfig()
            : defaultProjectNetworkConfig();

        const next: ProjectNetworkConfig = {
            ...current,
            dnsProviderId: input.dnsProviderId !== undefined ? (input.dnsProviderId as string | null) : current.dnsProviderId,
            zoneId: input.zoneId !== undefined ? (input.zoneId as string | null) : current.zoneId,
            zoneName: typeof input.zoneName === "string" ? input.zoneName : current.zoneName,
            autoProvisionRecords: typeof input.autoProvisionRecords === "boolean" ? input.autoProvisionRecords : current.autoProvisionRecords,
            proxiedDefault: typeof input.proxiedDefault === "boolean" ? input.proxiedDefault : current.proxiedDefault,
            wildcardSubdomains: typeof input.wildcardSubdomains === "boolean" ? input.wildcardSubdomains : current.wildcardSubdomains,
            recordType: typeof input.recordType === "string" ? (input.recordType as ProjectNetworkConfig["recordType"]) : current.recordType,
            recordContent: input.recordContent !== undefined ? (input.recordContent as string | null) : current.recordContent,
        };

        // Resolve the zone name from the provider when a zone id is selected.
        if (next.zoneId && next.dnsProviderId) {
            try {
                const account = { providerId: next.dnsProviderId, providerType: "cloudflare" };
                const zones = await this.dnsService.listZones(account);
                const zone = zones.find((z) => z.id === next.zoneId);
                if (zone) {
                    next.zoneName = zone.name;
                }
            } catch (err) {
                this.logger.warn(`Failed to resolve zone name for ${projectId}: ${(err as Error).message}`);
            }
        }

        // Persist the config + sync the project baseDomain (derived from zone).
        await this.projectRepository.update(projectId, {
            network: next,
            baseDomain: next.zoneName ?? project.baseDomain,
        });

        return this.getNetwork(projectId);
    }
}
