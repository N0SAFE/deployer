import { DomainAdapter } from "@deployer/shared/core/modules/domain/adapters/domain.adapter";
import {
	ProjectDomainNotFoundError,
	ServiceDomainMappingDeletionError,
	ServiceDomainMappingNotFoundError,
	ServiceDomainMappingUpdateError,
	ServiceMappingMismatchError,
	SetPrimaryDomainError,
	SubdomainConflictError,
} from "@deployer/shared/core/modules/domain/errors/index";
import { attempt } from "@project/core/effect/attempt";
import { DomainConflict } from "@project/core/ports/domain-conflict.port";
import { ProjectAccess } from "@project/core/ports/project-access.port";
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { ServiceDomainMappingRepo } from "@project/core/ports/service-domain-mapping-repository.port";
import { Context, Effect } from "effect";

export type CheckSubdomainInput = {
	readonly projectDomainId: string;
	readonly subdomain: string | null;
	readonly basePath: string | null;
	readonly excludeServiceId?: string;
};

export type AddServiceDomainInput = {
	readonly serviceId: string;
	readonly projectDomainId: string;
	readonly subdomain: string | null;
	readonly basePath: string | null;
	readonly isPrimary: boolean;
	readonly sslEnabled: boolean;
	readonly sslProvider: "letsencrypt" | "custom" | "none";
};

export type UpdateServiceDomainInput = {
	readonly mappingId: string;
	readonly subdomain?: string | null;
	readonly basePath?: string | null;
	readonly isPrimary?: boolean;
	readonly sslEnabled?: boolean;
	readonly sslProvider?: "letsencrypt" | "custom" | "none";
};

/** Shared access rule: only owner or maintainer may manage this project's domains. */
function assertAccess(projectId: string, requesterId: string) {
	return Effect.gen(function* () {
		const access = yield* ProjectAccess;
		yield* attempt(() =>
			access.assertProjectAccess(
				projectId,
				requesterId,
				["owner", "maintainer"],
				"You do not have permission to manage domains for this project",
			),
		);
	});
}

/** The service-domain mapping use cases, composed as Effects. */
export class DomainServiceServiceImpl {
	checkSubdomainAvailability(input: CheckSubdomainInput) {
		return Effect.gen(function* () {
			const conflicts = yield* DomainConflict;
			return yield* attempt(() =>
				conflicts.checkSubdomainAvailability(
					input.projectDomainId,
					input.subdomain,
					input.basePath,
					input.excludeServiceId,
				),
			);
		});
	}

	listServiceDomains(input: { readonly serviceId: string }) {
		return Effect.gen(function* () {
			const mappings = yield* ServiceDomainMappingRepo;
			const domains = yield* ProjectDomainRepo;

			const rows = yield* attempt(() =>
				mappings.findByServiceIdWithUrls(input.serviceId),
			);

			return yield* Effect.all(
				rows.map((mapping) =>
					Effect.gen(function* () {
						const projectDomain = yield* attempt(() =>
							domains.findById(mapping.projectDomainId),
						);
						if (!projectDomain) {
							return yield* Effect.fail(
								new ProjectDomainNotFoundError(mapping.projectDomainId),
							);
						}

						return {
							...DomainAdapter.toServiceDomainMappingWithUrl(
								mapping,
								mapping.fullUrl,
							),
							domain: projectDomain.domain,
						};
					}),
				),
			);
		});
	}

	addServiceDomain(input: AddServiceDomainInput, requesterId: string) {
		return Effect.gen(function* () {
			const mappings = yield* ServiceDomainMappingRepo;
			const domains = yield* ProjectDomainRepo;
			const conflicts = yield* DomainConflict;

			const projectDomain = yield* attempt(() =>
				domains.findById(input.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(
					new ProjectDomainNotFoundError(input.projectDomainId),
				);
			}

			yield* assertAccess(projectDomain.projectId, requesterId);

			const availability = yield* attempt(() =>
				conflicts.checkSubdomainAvailability(
					input.projectDomainId,
					input.subdomain,
					input.basePath,
				),
			);

			if (!availability.available) {
				const taken = availability.conflicts.map(
					(conflict) =>
						`${conflict.subdomain ?? "root"}.domain${conflict.basePath ?? "/"} (${conflict.serviceName})`,
				);
				return yield* Effect.fail(
					new SubdomainConflictError(
						input.subdomain,
						input.basePath,
						taken,
						availability.suggestions.availableBasePaths,
					),
				);
			}

			const mapping = yield* attempt(() =>
				mappings.create({
					serviceId: input.serviceId,
					projectDomainId: input.projectDomainId,
					subdomain: input.subdomain,
					basePath: input.basePath,
					isPrimary: input.isPrimary,
					sslEnabled: input.sslEnabled,
					sslProvider: input.sslProvider,
				}),
			);

			const fullUrl = yield* attempt(() => mappings.getFullUrl(mapping.id));
			if (!fullUrl) {
				return yield* Effect.fail(
					new ServiceDomainMappingNotFoundError(mapping.id),
				);
			}

			const sharedMappings = yield* attempt(() =>
				mappings.findBySubdomain(input.projectDomainId, input.subdomain),
			);

			const warning =
				sharedMappings.length > 1
					? {
							message: `This subdomain is shared with ${String(sharedMappings.length - 1)} other service(s)`,
							sharedWith: sharedMappings
								.filter((shared) => shared.id !== mapping.id)
								.slice(0, 5)
								.map((shared) => ({ serviceName: shared.serviceId, fullUrl })),
						}
					: undefined;

			return {
				mapping: {
					...DomainAdapter.toServiceDomainMappingWithUrl(mapping, fullUrl),
					domain: projectDomain.domain,
				},
				fullUrl,
				warning,
			};
		});
	}

	updateServiceDomain(input: UpdateServiceDomainInput, requesterId: string) {
		return Effect.gen(function* () {
			const mappings = yield* ServiceDomainMappingRepo;
			const domains = yield* ProjectDomainRepo;
			const conflicts = yield* DomainConflict;

			const mapping = yield* attempt(() => mappings.findById(input.mappingId));
			if (!mapping) {
				return yield* Effect.fail(
					new ServiceDomainMappingNotFoundError(input.mappingId),
				);
			}

			const projectDomain = yield* attempt(() =>
				domains.findById(mapping.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(
					new ProjectDomainNotFoundError(mapping.projectDomainId),
				);
			}

			yield* assertAccess(projectDomain.projectId, requesterId);

			if (input.subdomain !== undefined || input.basePath !== undefined) {
				const availability = yield* attempt(() =>
					conflicts.checkSubdomainAvailability(
						mapping.projectDomainId,
						input.subdomain ?? mapping.subdomain,
						input.basePath ?? mapping.basePath,
					),
				);

				if (!availability.available) {
					const taken = availability.conflicts.map(
						(conflict) =>
							`${conflict.subdomain ?? "root"}.domain${conflict.basePath ?? "/"} (${conflict.serviceName})`,
					);
					return yield* Effect.fail(
						new SubdomainConflictError(
							input.subdomain ?? mapping.subdomain,
							input.basePath ?? mapping.basePath,
							taken,
							availability.suggestions.availableBasePaths,
						),
					);
				}
			}

			const updated = yield* attempt(() =>
				mappings.update(input.mappingId, {
					...(input.subdomain !== undefined
						? { subdomain: input.subdomain }
						: {}),
					...(input.basePath !== undefined
						? { basePath: input.basePath }
						: {}),
					...(input.isPrimary !== undefined
						? { isPrimary: input.isPrimary }
						: {}),
					...(input.sslEnabled !== undefined
						? { sslEnabled: input.sslEnabled }
						: {}),
					...(input.sslProvider !== undefined
						? { sslProvider: input.sslProvider }
						: {}),
				}),
			);
			if (!updated) {
				return yield* Effect.fail(
					new ServiceDomainMappingUpdateError(input.mappingId),
				);
			}

			const fullUrl = yield* attempt(() => mappings.getFullUrl(updated.id));
			if (!fullUrl) {
				return yield* Effect.fail(
					new ServiceDomainMappingNotFoundError(updated.id),
				);
			}

			return {
				...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl),
				domain: projectDomain.domain,
			};
		});
	}

	setPrimaryServiceDomain(input: {
		readonly serviceId: string;
		readonly mappingId: string;
		readonly requesterId: string;
	}) {
		return Effect.gen(function* () {
			const mappings = yield* ServiceDomainMappingRepo;
			const domains = yield* ProjectDomainRepo;

			const mapping = yield* attempt(() => mappings.findById(input.mappingId));
			if (!mapping) {
				return yield* Effect.fail(
					new ServiceDomainMappingNotFoundError(input.mappingId),
				);
			}
			if (mapping.serviceId !== input.serviceId) {
				return yield* Effect.fail(
					new ServiceMappingMismatchError(input.mappingId, input.serviceId),
				);
			}

			const projectDomain = yield* attempt(() =>
				domains.findById(mapping.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(
					new ProjectDomainNotFoundError(mapping.projectDomainId),
				);
			}

			yield* assertAccess(projectDomain.projectId, input.requesterId);

			const allMappings = yield* attempt(() =>
				mappings.findByServiceId(input.serviceId),
			);
			yield* Effect.all(
				allMappings
					.filter(
						(serviceMapping) =>
							serviceMapping.id !== input.mappingId &&
							serviceMapping.isPrimary,
					)
					.map((serviceMapping) =>
						attempt(() =>
							mappings.update(serviceMapping.id, { isPrimary: false }),
						),
					),
			);

			const updated = yield* attempt(() =>
				mappings.update(input.mappingId, { isPrimary: true }),
			);
			if (!updated) {
				return yield* Effect.fail(
					new SetPrimaryDomainError(input.serviceId, input.mappingId),
				);
			}

			const fullUrl = yield* attempt(() => mappings.getFullUrl(updated.id));
			if (!fullUrl) {
				return yield* Effect.fail(
					new ServiceDomainMappingNotFoundError(updated.id),
				);
			}

			const domain = yield* attempt(() =>
				domains.findById(updated.projectDomainId),
			);
			if (!domain) {
				return yield* Effect.fail(
					new ProjectDomainNotFoundError(updated.projectDomainId),
				);
			}

			return {
				...DomainAdapter.toServiceDomainMappingWithUrl(updated, fullUrl),
				domain: domain.domain,
			};
		});
	}

	removeServiceDomain(input: {
		readonly serviceId: string;
		readonly mappingId: string;
		readonly requesterId: string;
	}) {
		return Effect.gen(function* () {
			const mappings = yield* ServiceDomainMappingRepo;
			const domains = yield* ProjectDomainRepo;

			const mapping = yield* attempt(() => mappings.findById(input.mappingId));
			if (!mapping) {
				return yield* Effect.fail(
					new ServiceDomainMappingNotFoundError(input.mappingId),
				);
			}
			if (mapping.serviceId !== input.serviceId) {
				return yield* Effect.fail(
					new ServiceMappingMismatchError(input.mappingId, input.serviceId),
				);
			}

			const projectDomain = yield* attempt(() =>
				domains.findById(mapping.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(
					new ProjectDomainNotFoundError(mapping.projectDomainId),
				);
			}

			yield* assertAccess(projectDomain.projectId, input.requesterId);

			const deleted = yield* attempt(() => mappings.delete(input.mappingId));
			if (!deleted) {
				return yield* Effect.fail(
					new ServiceDomainMappingDeletionError(input.mappingId),
				);
			}

			return {
				success: true,
				message: "Domain mapping removed from service successfully",
			};
		});
	}
}

/** The service's public surface is exactly the implementation's methods. */
export type DomainServiceServiceShape = DomainServiceServiceImpl;

/** Effect key = NestJS token. */
export class DomainServiceService extends Context.Service<DomainServiceService, DomainServiceServiceShape>()(
	"project/DomainServiceService",
) {}
