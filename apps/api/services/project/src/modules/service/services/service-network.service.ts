import { Logger } from "@nestjs/common";
import z from "zod/v4";
import {
    defaultServiceNetworkConfig,
    serviceNetworkConfigSchema,
    projectNetworkConfigSchema,
    type ServiceNetworkConfig,
} from "@deployer/contracts-entities";
import { type ServiceNetworkView, type ServiceProvisionDnsRecordInput } from "@deployer/project-contracts";
import { BadRequestError, NotFoundError } from "@deployer/errors";
import { Context, Effect } from "effect";
import { attempt } from "@project/core/effect/attempt";
import { DnsProvider } from "@project/core/ports/dns-provider.port";
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { ServiceDomainMappingLookup } from "@project/core/ports/service-domain-mapping-lookup.port";
import { ProjectStore } from "@/modules/project/repositories/project.repository";
import { ServiceStore } from "../repositories/service.repository";

/** Validate a provider record type against the contract's full enum. */
const recordTypeSchema = z.enum([
    "A", "AAAA", "CAA", "CERT", "CNAME", "DNSKEY", "DS", "HTTPS", "LOC", "MX", "NAPTR", "NS", "OPENPGPKEY", "PTR", "SMIMEA", "SRV", "SVCB", "TLSA", "TXT", "URI",
] as const);

/**
 * A provider record, narrowed to the view shape.
 *
 * `zoneId` is passed in rather than read off the record: the contract identifies the
 * zone in the URL path, so the record it returns does not carry it back.
 */
const mapRecord = (
    zoneId: string,
    r: { id: string; name: string; type: string; content: string; ttl: number; proxied?: boolean },
): ServiceNetworkView["records"][number] => ({
    id: r.id,
    zoneId,
    name: r.name,
    type: recordTypeSchema.safeParse(r.type).success ? (recordTypeSchema.parse(r.type)) : "TXT",
    content: r.content,
    ttl: r.ttl,
    proxied: r.proxied ?? false,
});

const logger = new Logger("ServiceNetworkService");

/** Build the full URL for a domain binding (subdomain + basePath). */
function buildFullUrl(domain: string, subdomain: string | null, basePath: string | null): string {
    const host = subdomain?.trim() ? `${subdomain.trim()}.${domain}` : domain;
    const path = basePath?.trim() ? `/${basePath.replace(/^\/+/, "").replace(/\/+$/, "")}` : "";
    return `${host}${path}`;
}

/** Resolve the effective provider/zone for a service (override → project). */
function resolveScope(
    service: { id: string; projectId: string; network: ServiceNetworkConfig | null },
) {
    return Effect.gen(function* () {
        const projects = yield* ProjectStore;
        const project = yield* projects.findById(service.projectId);
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
    });
}

/** Build the network view for a service. */
function loadNetworkView(serviceId: string) {
    return Effect.gen(function* () {
        const services = yield* ServiceStore;
        const dns = yield* DnsProvider;
        const domains = yield* ProjectDomainRepo;
        const mappings = yield* ServiceDomainMappingLookup;

        const service = yield* services.findById(serviceId);
        if (!service) {
            return yield* Effect.fail(new NotFoundError("Service", serviceId));
        }

        const network = service.network
            ? serviceNetworkConfigSchema.safeParse(service.network).data ?? null
            : null;

        const scope = yield* resolveScope(service);

        let records: ServiceNetworkView["records"] = [];
        if (scope.providerId !== null && scope.zoneId !== null) {
            // Narrowed once into locals: the contract takes ids as path params, so the
            // call needs non-null strings and the guard above is the only check.
            const { providerId, zoneId } = scope;
            records = yield* attempt(() => dns.listRecords(providerId, zoneId)).pipe(
                Effect.map((providerRecords) => providerRecords.map((r) => mapRecord(zoneId, r))),
                Effect.catch((err) => {
                    logger.warn(`Failed to fetch zone records for service ${serviceId}: ${err.message}`);
                    return Effect.succeed([] as ServiceNetworkView["records"]);
                }),
            );
        }

        // Registered project domains (already bound to this project) with their
        // allowed subdomains + existing service mappings — the autocomplete
        // source for this service's domain bindings.
        const rawProjectDomains = yield* attempt(() => domains.findByProjectId(service.projectId));
        const projectDomains: ServiceNetworkView["projectDomains"] = [];
        for (const pd of rawProjectDomains) {
            const domain = pd.domain;
            const existing = yield* attempt(() =>
                mappings.findByProjectDomainAndPathWithServiceNames(pd.id, null),
            );
            projectDomains.push({
                id: pd.id,
                domain,
                allowedSubdomains: pd.allowedSubdomains,
                isPrimary: pd.isPrimary,
                existingMappings: existing.map((m) => ({
                    serviceId: m.serviceId,
                    serviceName: m.serviceName,
                    subdomain: m.subdomain,
                    basePath: m.basePath,
                    fullUrl: buildFullUrl(domain, m.subdomain, m.basePath),
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
    });
}

/** Update the service network config (overrides project defaults). */
function persistNetwork(serviceId: string, input: Record<string, unknown>) {
    return Effect.gen(function* () {
        const services = yield* ServiceStore;

        const service = yield* services.findById(serviceId);
        if (!service) {
            return yield* Effect.fail(new NotFoundError("Service", serviceId));
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

        yield* services.update(serviceId, { network: next });
        return yield* loadNetworkView(serviceId);
    });
}

/**
 * Service Network use cases — provider-backed networking for a single service.
 *
 * A service INHERITS the project's DNS provider + zone unless it overrides
 * them in its own `network` config. This service:
 * - Resolves the effective provider/zone (service override → project config).
 * - Reads/writes the service `network` config (persisted in services.network).
 * - Lists zone records (live) for the resolved provider/zone.
 * - Auto-provisions DNS records (A/CNAME/TXT) via the provider.
 */
export class ServiceNetworkServiceImpl {
    /** Build the network view for a service. */
    getNetwork(serviceId: string) {
        return loadNetworkView(serviceId);
    }

    /** Update the service network config (overrides project defaults). */
    updateNetwork(serviceId: string, input: Record<string, unknown>) {
        return persistNetwork(serviceId, input);
    }

    /** Auto-provision a DNS record for the service in the resolved zone. */
    provisionDnsRecord(serviceId: string, input: ServiceProvisionDnsRecordInput) {
        return Effect.gen(function* () {
            const services = yield* ServiceStore;
            const dns = yield* DnsProvider;

            const service = yield* services.findById(serviceId);
            if (!service) {
                return yield* Effect.fail(new NotFoundError("Service", serviceId));
            }

            const scope = yield* resolveScope(service);
            if (!scope.providerId || !scope.zoneId || !scope.zoneName) {
                return yield* Effect.fail(
                    new BadRequestError(
                        "No DNS provider/zone configured. Configure the project network config first (DNS provider + zone).",
                    ),
                );
            }

            // Narrowed once into locals: the guard above is the only check, and
            // the closures below would otherwise lose the narrowing.
            const { providerId, zoneId } = scope;
            return yield* attempt(() =>
                dns.createRecord(providerId, zoneId, {
                    type: input.type,
                    name: input.name,
                    content: input.content,
                    ttl: input.ttl,
                    proxied: input.proxied ?? true,
                }),
            ).pipe(
                Effect.map((record) => ({
                    success: true,
                    record: {
                        id: record.id,
                        zoneId,
                        name: record.name,
                        type: recordTypeSchema.safeParse(record.type).success ? (recordTypeSchema.parse(record.type)) : "TXT",
                        content: record.content,
                        ttl: record.ttl,
                        proxied: record.proxied ?? false,
                    },
                    message: `DNS record created: ${record.name} → ${record.content}`,
                })),
                Effect.catch((err) => {
                    logger.error(`Failed to provision DNS record for service ${serviceId}: ${err.message}`);
                    return Effect.succeed({
                        success: false,
                        record: null,
                        message: `Failed to create DNS record: ${err.message}`,
                    });
                }),
            );
        });
    }
}

/** The service's public surface is exactly the implementation's methods. */
export type ServiceNetworkServiceShape = ServiceNetworkServiceImpl;

/** Effect key = NestJS token. */
export class ServiceNetworkService extends Context.Service<
    ServiceNetworkService,
    ServiceNetworkServiceShape
>()("project/ServiceNetworkService") {}
