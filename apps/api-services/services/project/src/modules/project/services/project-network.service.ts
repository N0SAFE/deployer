import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import z from "zod/v4";
import {
    defaultProjectNetworkConfig,
    projectNetworkConfigSchema,
    type ProjectNetworkConfig,
} from "@deployer/contracts-entities";
import type { ProjectNetworkView, ProjectUpdateNetworkInput } from "@deployer/project-contracts";
import { providersContract } from "@deployer/fleet-contracts";
import { ServiceClient } from "@deployer/shared/server";
import { ProjectDomainRepository } from "@/core/modules/domain/repositories/project-domain.repository";
import { ProjectRepository } from "../repositories/project.repository";

/** Validate a provider record type against the contract's full enum. */
const recordTypeSchema = z.enum([
    "A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC", "MX", "NAPTR", "NS", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SVCB", "TLSA", "TXT", "URI",
] as const);

const mapRecord = (
    r: {
        id: string; name: string; type: string; content: string; ttl: number; proxied?: boolean;
    },
    zoneId: string,
): ProjectNetworkView["records"][number] => ({
    id: r.id,
    // The provider returns a record WITHOUT its zone (it is addressed by the path), while
    // the view carries one so a client can tell which zone it belongs to. Supplying it from
    // the request is what makes the projection self-describing.
    zoneId,
    name: r.name,
    type: recordTypeSchema.safeParse(r.type).success ? recordTypeSchema.parse(r.type) : "TXT",
    content: r.content,
    ttl: r.ttl,
    // Optional in the provider's schema, required in the view: absent means the provider
    // applies its default, and the view has no representation for that, so it is read as
    // the default the platform assumes (proxied).
    proxied: r.proxied ?? true,
});

/**
 * Project Network Service — provider-backed network configuration.
 *
 * A project anchors its networking to ONE DNS provider account + ONE zone. The zone name
 * becomes the project's base domain. What this service owns is the PROJECT's half: reading
 * and writing `projects.network`, and deciding which of the provider's zones/records the
 * project's config refers to.
 *
 * ── WHY THE DNS CALLS GO TO FLEET OVER ITS CONTRACT ─────────────────────────
 * The provider apps, their zones and their records are FLEET's state — fleet owns the DNS
 * domain and serves `providersContract`. Letting this service import `CloudflareAppService`
 * directly is exactly the cross-service coupling the split exists to remove: it made the
 * project domain depend on another domain's implementation, so a change to how DNS is
 * modelled broke the project build. It now calls the contract, and what crosses the boundary
 * is the answer, not the machinery.
 */
@Injectable()
export class ProjectNetworkService {
    private readonly logger = new Logger(ProjectNetworkService.name);

    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly projectDomainRepository: ProjectDomainRepository,
        private readonly services: ServiceClient,
    ) {}

    /** The fleet-owned DNS surface, reached over its contract. */
    private get dns() {
        return this.services.clientFor("fleet", providersContract).dns;
    }

    /**
     * Build the network view for a project: config + provider discovery.
     * Zones/records are fetched LIVE from the selected provider when the project has a
     * network config with a provider pinned.
     */
    async getNetwork(projectId: string): Promise<ProjectNetworkView> {
        const project = await this.projectRepository.findById(projectId);
        if (!project) {
            throw new NotFoundException(`Project not found: ${projectId}`);
        }

        const network = project.network
            ? projectNetworkConfigSchema.safeParse(project.network).data ?? null
            : null;

        const { providers } = await this.dns.list({});

        let zones: ProjectNetworkView["zones"] = [];
        let records: ProjectNetworkView["records"] = [];

        if (network?.dnsProviderId && network.zoneId) {
            // Hoisted to consts: TypeScript drops the `network?.` narrowing inside the
            // arrow functions below, and passing a `string | null` where the contract
            // requires a path parameter would otherwise need a non-null assertion.
            const providerId = network.dnsProviderId;
            const zoneId = network.zoneId;
            try {
                const { zones: providerZones } = await this.dns.cloudflare.listZones({
                    params: { providerId },
                });
                zones = providerZones.map((zone) => ({
                    // The contract wraps the list in a `zones` envelope and marks `nameServers`
                    // optional, while the view declares a NON-NULL array — the `?? []`
                    // reconciles the two rather than letting `undefined` reach the client.
                    id: zone.id,
                    name: zone.name,
                    status: zone.status,
                    nameServers: zone.nameServers ?? [],
                }));

                const { records: providerRecords } = await this.dns.cloudflare.listRecords({
                    params: { providerId, zoneId },
                });
                records = providerRecords.map((record) => mapRecord(record, zoneId));
            } catch (error) {
                // Not fatal: the project's own config is still answerable, and an unreachable
                // provider is a degraded view rather than a failed request. Logged with the
                // project so an operator can tell WHICH project hit it.
                this.logger.warn(
                    `Failed to fetch zones/records for project ${projectId}: ${(error as Error).message}`,
                );
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
                const { zones } = await this.dns.cloudflare.listZones({
                    params: { providerId: next.dnsProviderId },
                });
                const zone = zones.find((z) => z.id === next.zoneId);
                if (zone) {
                    next.zoneName = zone.name;
                }
            } catch (error) {
                this.logger.warn(`Failed to resolve zone name for ${projectId}: ${(error as Error).message}`);
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
