import { Logger } from "@nestjs/common";
import z from "zod/v4";
import {
	defaultProjectNetworkConfig,
	projectNetworkConfigSchema,
	type ProjectNetworkConfig,
} from "@deployer/contracts-entities";
import { type ProjectNetworkView } from "@deployer/project-contracts";
import { NotFoundError } from "@deployer/errors";
import { Context, Effect } from "effect";
import { attempt } from "@project/core/effect/attempt";
import { DnsProvider } from "@project/core/ports/dns-provider.port";
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { ProjectStore } from "../repositories/project.repository";

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
): ProjectNetworkView["records"][number] => ({
	id: r.id,
	zoneId,
	name: r.name,
	type: recordTypeSchema.safeParse(r.type).success ? recordTypeSchema.parse(r.type) : "TXT",
	content: r.content,
	ttl: r.ttl,
	proxied: r.proxied ?? false,
});

const logger = new Logger("ProjectNetworkService");

/**
 * Build the network view for a project: config + provider discovery.
 * Zones/records are fetched LIVE from the selected provider when the
 * project has a network config with a provider pinned.
 */
function loadNetworkView(projectId: string) {
	return Effect.gen(function* () {
		const projects = yield* ProjectStore;
		const dns = yield* DnsProvider;
		const projectDomainsRepository = yield* ProjectDomainRepo;

		const project = yield* projects.findById(projectId);
		if (!project) {
			return yield* Effect.fail(new NotFoundError("Project", projectId));
		}

		const network = project.network
			? projectNetworkConfigSchema.safeParse(project.network).data ?? null
			: null;

		const providers = yield* attempt(() => dns.listProviders());

		let zones: ProjectNetworkView["zones"] = [];
		let records: ProjectNetworkView["records"] = [];

		if (network?.dnsProviderId && network.zoneId) {
			// Narrowed once into locals: the contract takes ids as path params, so the
			// call site needs non-null strings and the guard above is the only check.
			const { dnsProviderId, zoneId } = network;
			const fetched = yield* attempt(async () => {
				const providerZones = await dns.listZones(dnsProviderId);
				const mappedZones = providerZones.map((z) => ({
					id: z.id,
					name: z.name,
					status: z.status,
					// The contract makes `nameServers` optional (Cloudflare omits it on
					// some responses); the view always carries an array.
					nameServers: z.nameServers ?? [],
				}));
				const providerRecords = await dns.listRecords(dnsProviderId, zoneId);
				return {
					zones: mappedZones,
					records: providerRecords.map((r) => mapRecord(zoneId, r)),
				};
			}).pipe(
				Effect.catch((err) => {
					logger.warn(
						`Failed to fetch zones/records for project ${projectId}: ${err.message}`,
					);
					return Effect.succeed({
						zones: [] as ProjectNetworkView["zones"],
						records: [] as ProjectNetworkView["records"],
					});
				}),
			);
			zones = fetched.zones;
			records = fetched.records;
		}

		// This project's verified domains (direct-domain model — candidates for base domain).
		const projectDomainsRaw = yield* attempt(() =>
			projectDomainsRepository.findByProjectId(projectId),
		);
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
	});
}

/**
 * Project Network use cases — provider-backed network configuration.
 *
 * A project anchors its networking to ONE DNS provider account + ONE zone.
 * The zone name becomes the project's base domain. This service:
 * - Reads/writes the project `network` config (persisted in projects.network).
 * - Discovers available DNS providers + their zones + zone records (live).
 * - Lists existing org domains + project domains (candidates for base domain).
 */
export class ProjectNetworkServiceImpl {
	/** The network view for a project. */
	getNetwork(projectId: string) {
		return loadNetworkView(projectId);
	}

	/**
	 * Update the project network config. When `dnsProviderId`/`zoneId` change,
	 * the zone name becomes the project's base domain (kept in sync).
	 */
	updateNetwork(projectId: string, input: Record<string, unknown>) {
		return Effect.gen(function* () {
			const projects = yield* ProjectStore;
			const dns = yield* DnsProvider;

			const project = yield* projects.findById(projectId);
			if (!project) {
				return yield* Effect.fail(new NotFoundError("Project", projectId));
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
			const { dnsProviderId, zoneId } = next;
			if (zoneId && dnsProviderId) {
				const zoneName = yield* attempt(() =>
					dns.findZoneName(dnsProviderId, zoneId),
				).pipe(
					Effect.catch((err) => {
						logger.warn(`Failed to resolve zone name for ${projectId}: ${err.message}`);
						return Effect.succeed(undefined);
					}),
				);
				if (zoneName) {
					next.zoneName = zoneName;
				}
			}

			// Persist the config + sync the project baseDomain (derived from zone).
			yield* projects.update(projectId, {
				network: next,
				baseDomain: next.zoneName ?? project.baseDomain,
			});

			return yield* loadNetworkView(projectId);
		});
	}
}

/** The service's public surface is exactly the implementation's methods. */
export type ProjectNetworkServiceShape = ProjectNetworkServiceImpl;

/** Effect key = NestJS token. */
export class ProjectNetworkService extends Context.Service<
	ProjectNetworkService,
	ProjectNetworkServiceShape
>()("project/ProjectNetworkService") {}
