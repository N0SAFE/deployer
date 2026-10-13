import { Injectable, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import z from "zod/v4";
import {
    defaultServiceNetworkConfig,
    serviceNetworkConfigSchema,
    projectNetworkConfigSchema,
    type ServiceNetworkConfig,
} from "@deployer/contracts-entities";
import type { ServiceNetworkView, ServiceUpdateNetworkInput, ServiceProvisionDnsRecordInput } from "@deployer/project-contracts";
import { providersContract } from "@deployer/fleet-contracts";
import { ServiceClient } from "@deployer/shared/server";
import { ProjectRepository } from "@/modules/project/repositories/project.repository";
import { ProjectDomainRepository } from "@/core/modules/domain/repositories/project-domain.repository";
import { ServiceDomainMappingRepository } from "@/core/modules/domain/repositories/service-domain-mapping.repository";
import { ServiceRepository } from "../repositories/service.repository";

/** Validate a provider record type against the contract's full enum. */
const recordTypeSchema = z.enum([
    "A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC", "MX", "NAPTR", "NS", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SVCB", "TLSA", "TXT", "URI",
] as const);

const mapRecord = (
    r: {
        id: string; name: string; type: string; content: string; ttl: number; proxied?: boolean;
    },
    zoneId: string,
): ServiceNetworkView["records"][number] => ({
    id: r.id,
    // The provider addresses a record BY PATH and returns no zone, while the view carries one
    // so a client can tell which zone it belongs to. Supplying it from the request is what
    // makes the projection self-describing.
    zoneId,
    name: r.name,
    type: recordTypeSchema.safeParse(r.type).success ? recordTypeSchema.parse(r.type) : "TXT",
    content: r.content,
    ttl: r.ttl,
    // Optional in the provider's schema, required in the view: absent means the provider
    // applies its default, which the view cannot represent, so the platform's default is used.
    proxied: r.proxied ?? true,
});

/**
 * Service Network Service — provider-backed networking for a single service.
 *
 * A service INHERITS the project's DNS provider + zone unless it overrides
 * them in its own `network` config. This service:
 * - Resolves the effective provider/zone (service override → project config).
 * - Reads/writes the service `network` config (persisted in services.network).
 * - Lists zone records (live) for the resolved provider/zone.
 * - Auto-provisions DNS records (A/CNAME/TXT) via the provider.
 */
@Injectable()
export class ServiceNetworkService {
    private readonly logger = new Logger(ServiceNetworkService.name);

    constructor(
        private readonly serviceRepository: ServiceRepository,
        private readonly projectRepository: ProjectRepository,
        private readonly projectDomainRepository: ProjectDomainRepository,
        private readonly mappingRepository: ServiceDomainMappingRepository,
        private readonly services: ServiceClient,
    ) {}

    /**
     * The fleet-owned DNS surface, reached over its contract.
     *
     * ── WHY NOT THE PROVIDER SERVICE DIRECTLY ───────────────────────────────
     * The provider apps, zones and records are FLEET's state. Importing
     * `CloudflareDnsProviderService` here made this domain compile against another
     * domain's implementation — a change to how DNS is modelled then broke the project
     * build, which is the coupling the split removes. Over the contract, what crosses the
     * boundary is the answer, not the machinery.
     */
    private get dns() {
        return this.services.clientFor("fleet", providersContract).dns;
    }

    /** Resolve the effective provider/zone for a service (override → project). */
    private async resolveScope(
        service: { id: string; projectId: string; network: ServiceNetworkConfig | null },
    ): Promise<{ providerId: string | null; zoneId: string | null; zoneName: string | null }> {
        const project = await this.projectRepository.findById(service.projectId);
        const projectNetwork = project?.network
            ? projectNetworkConfigSchema.safeParse(project.network).data ?? null
            : null;

        const svcNetwork = service.network
            ? serviceNetworkConfigSchema.safeParse(service.network).data ?? null
            : null;

        const providerId = svcNetwork?.dnsProviderId ?? projectNetwork?.dnsProviderId ?? null;
        const zoneId = svcNetwork?.zoneId ?? projectNetwork?.zoneId ?? null;
        const zoneName = svcNetwork?.zoneName ?? projectNetwork?.zoneName ?? null;
        return { providerId, zoneId, zoneName };
    }

    /** Build the network view for a service. */
    async getNetwork(serviceId: string): Promise<ServiceNetworkView> {
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        const network = service.network
            ? serviceNetworkConfigSchema.safeParse(service.network).data ?? null
            : null;

        const scope = await this.resolveScope(service);

        let records: ServiceNetworkView["records"] = [];
        if (scope.providerId && scope.zoneId) {
            // Hoisted to consts: TypeScript drops the `scope.` narrowing inside the arrow
            // function below, and a `string | null` cannot satisfy the contract's path
            // parameter without a non-null assertion.
            const providerId = scope.providerId;
            const zoneId = scope.zoneId;
            try {
                const { records: providerRecords } = await this.dns.cloudflare.listRecords({
                    params: { providerId, zoneId },
                });
                records = providerRecords.map((record) => mapRecord(record, zoneId));
            } catch (error) {
                // Degraded, not failed: the service's own config is still answerable without
                // the live records, so an unreachable provider must not blank the whole view.
                this.logger.warn(`Failed to fetch zone records for service ${serviceId}: ${(error as Error).message}`);
            }
        }

        // Registered project domains (already bound to this project) with their
        // allowed subdomains + existing service mappings — the autocomplete
        // source for this service's domain bindings.
        const projectDomains: ServiceNetworkView["projectDomains"] = [];
        const rawProjectDomains = await this.projectDomainRepository.findByProjectId(service.projectId);
        for (const pd of rawProjectDomains) {
            const domain = pd.domain;
            const mappings = await this.mappingRepository.findByProjectDomainAndPathWithServiceNames(pd.id, null);
            projectDomains.push({
                id: pd.id,
                domain,
                allowedSubdomains: pd.allowedSubdomains,
                isPrimary: pd.isPrimary,
                existingMappings: mappings.map((m) => ({
                    serviceId: m.serviceId,
                    serviceName: m.serviceName,
                    subdomain: m.subdomain,
                    basePath: m.basePath,
                    fullUrl: this.buildFullUrl(domain, m.subdomain, m.basePath),
                })),
            });
        }

        return {
            network,
            dnsProviderId: scope.providerId,
            zoneId: scope.zoneId,
            zoneName: scope.zoneName,
            records,
            projectDomains,
        };
    }

    /** Build the full URL for a domain binding (subdomain + basePath). */
    private buildFullUrl(domain: string, subdomain: string | null, basePath: string | null): string {
        const host = subdomain && subdomain.trim() ? `${subdomain.trim()}.${domain}` : domain;
        const path = basePath && basePath.trim() ? `/${basePath.replace(/^\/+/, "").replace(/\/+$/, "")}` : "";
        return `${host}${path}`;
    }

    /** Update the service network config (overrides project defaults). */
    async updateNetwork(serviceId: string, input: Record<string, unknown>): Promise<ServiceNetworkView> {
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        const current = service.network
            ? serviceNetworkConfigSchema.safeParse(service.network).data ?? defaultServiceNetworkConfig()
            : defaultServiceNetworkConfig();

        const next: ServiceNetworkConfig = {
            ...current,
            dnsProviderId: input.dnsProviderId !== undefined ? (input.dnsProviderId as string | null) : current.dnsProviderId,
            zoneId: input.zoneId !== undefined ? (input.zoneId as string | null) : current.zoneId,
            zoneName: typeof input.zoneName === "string" ? input.zoneName : current.zoneName,
            recordType: typeof input.recordType === "string" ? (input.recordType as ServiceNetworkConfig["recordType"]) : current.recordType,
            recordContent: input.recordContent !== undefined ? (input.recordContent as string | null) : current.recordContent,
            proxied: typeof input.proxied === "boolean" ? input.proxied : current.proxied,
            autoProvision: typeof input.autoProvision === "boolean" ? input.autoProvision : current.autoProvision,
            visibility: input.visibility === "private" || input.visibility === "public" ? input.visibility : current.visibility,
            tls: input.tls && typeof input.tls === "object"
                ? {
                      enabled: typeof (input.tls as { enabled?: unknown }).enabled === "boolean" ? (input.tls as { enabled: boolean }).enabled : current.tls.enabled,
                      httpRedirect: typeof (input.tls as { httpRedirect?: unknown }).httpRedirect === "boolean" ? (input.tls as { httpRedirect: boolean }).httpRedirect : current.tls.httpRedirect,
                  }
                : current.tls,
        };

        await this.serviceRepository.update(serviceId, { network: next });
        return this.getNetwork(serviceId);
    }

    /** Auto-provision a DNS record for the service in the resolved zone. */
    async provisionDnsRecord(
        serviceId: string,
        input: ServiceProvisionDnsRecordInput,
    ): Promise<{ success: boolean; record: ServiceNetworkView["records"][number] | null; message: string }> {
        const service = await this.serviceRepository.findById(serviceId);
        if (!service) {
            throw new NotFoundException(`Service not found: ${serviceId}`);
        }

        const scope = await this.resolveScope(service);
        if (!scope.providerId || !scope.zoneId || !scope.zoneName) {
            throw new BadRequestException(
                "No DNS provider/zone configured. Configure the project network config first (DNS provider + zone).",
            );
        }

        try {
            const record = await this.dns.cloudflare.createRecord({
                params: { providerId: scope.providerId, zoneId: scope.zoneId },
                body: {
                    type: input.type,
                    name: input.name,
                    content: input.content,
                    ttl: input.ttl,
                    proxied: input.proxied ?? true,
                },
            });
            return {
                success: true,
                record: {
                    id: record.id,
                    // The provider does not echo the zone it was addressed under, so the one
                    // from the request is used — the same reason the list projection needs it.
                    zoneId: scope.zoneId,
                    name: record.name,
                    type: recordTypeSchema.safeParse(record.type).success ? recordTypeSchema.parse(record.type) : "TXT",
                    content: record.content,
                    ttl: record.ttl,
                    proxied: record.proxied ?? true,
                },
                message: `DNS record created: ${record.name} → ${record.content}`,
            };
        } catch (err) {
            this.logger.error(`Failed to provision DNS record for service ${serviceId}: ${(err as Error).message}`);
            return {
                success: false,
                record: null,
                message: `Failed to create DNS record: ${(err as Error).message}`,
            };
        }
    }
}
