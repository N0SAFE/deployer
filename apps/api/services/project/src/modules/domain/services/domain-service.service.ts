import { DomainConflictService } from "@deployer/shared/core/modules/domain/services/domain-conflict.service";
import { ServiceDomainMappingRepository } from "@deployer/shared/core/modules/domain/repositories/service-domain-mapping.repository";
import { ProjectDomainRepository } from "@deployer/shared/core/modules/domain/repositories/project-domain.repository";
import { Context, Effect } from "effect";

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
import { ProjectAccessService } from "@deployer/shared/core/modules/project/services/project-access.service";

import { attempt, toFailure, refuse } from "@/modules/project/project-effects";


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
		const access = yield* ProjectAccessService;
		yield* access.assertProjectAccess(
			projectId,
			requesterId,
			["owner", "maintainer"],
			"You do not have permission to manage domains for this project",
		);
	});
}

/** The service-domain mapping use cases, composed as Effects. */
export class DomainServiceServiceImpl {
	checkSubdomainAvailability(input: CheckSubdomainInput) {
		return Effect.gen(function* () {
			const conflicts = yield* DomainConflictService;
			return yield* refuse(
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
			const mappings = yield* ServiceDomainMappingRepository;
			const domains = yield* ProjectDomainRepository;

			const rows = yield* refuse(
				mappings.findByServiceIdWithUrls(input.serviceId),
			);

			return yield* Effect.all(
				rows.map((mapping) =>
					Effect.gen(function* () {
						const projectDomain = yield* refuse(
							domains.findById(mapping.projectDomainId),
						);
						if (!projectDomain) {
							return yield* Effect.fail(toFailure(new ProjectDomainNotFoundError({ identifier: mapping.projectDomainId })));
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
			const mappings = yield* ServiceDomainMappingRepository;
			const domains = yield* ProjectDomainRepository;
			const conflicts = yield* DomainConflictService;

			const projectDomain = yield* refuse(
				domains.findById(input.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(toFailure(new ProjectDomainNotFoundError({ identifier: input.projectDomainId })));
			}

			yield* assertAccess(projectDomain.projectId, requesterId);

			const availability = yield* refuse(
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
				return yield* Effect.fail(toFailure(new SubdomainConflictError({ subdomain: input.subdomain, basePath: input.basePath, conflicts: taken, availableBasePaths: availability.suggestions.availableBasePaths })));
			}

			const mapping = yield* refuse(
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

			const fullUrl = yield* refuse( mappings.getFullUrl(mapping.id));
			if (!fullUrl) {
				return yield* Effect.fail(toFailure(new ServiceDomainMappingNotFoundError({ identifier: mapping.id })));
			}

			const sharedMappings = yield* refuse(
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
			const mappings = yield* ServiceDomainMappingRepository;
			const domains = yield* ProjectDomainRepository;
			const conflicts = yield* DomainConflictService;

			const mapping = yield* refuse( mappings.findById(input.mappingId));
			if (!mapping) {
				return yield* Effect.fail(toFailure(new ServiceDomainMappingNotFoundError({ identifier: input.mappingId })));
			}

			const projectDomain = yield* refuse(
				domains.findById(mapping.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(toFailure(new ProjectDomainNotFoundError({ identifier: mapping.projectDomainId })));
			}

			yield* assertAccess(projectDomain.projectId, requesterId);

			if (input.subdomain !== undefined || input.basePath !== undefined) {
				const availability = yield* refuse(
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
					return yield* Effect.fail(toFailure(new SubdomainConflictError({ subdomain: input.subdomain ?? mapping.subdomain, basePath: input.basePath ?? mapping.basePath, conflicts: taken, availableBasePaths: availability.suggestions.availableBasePaths })));
				}
			}

			const updated = yield* refuse(
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
				return yield* Effect.fail(toFailure(new ServiceDomainMappingUpdateError({ mappingId: input.mappingId })));
			}

			const fullUrl = yield* refuse( mappings.getFullUrl(updated.id));
			if (!fullUrl) {
				return yield* Effect.fail(toFailure(new ServiceDomainMappingNotFoundError({ identifier: updated.id })));
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
			const mappings = yield* ServiceDomainMappingRepository;
			const domains = yield* ProjectDomainRepository;

			const mapping = yield* refuse( mappings.findById(input.mappingId));
			if (!mapping) {
				return yield* Effect.fail(toFailure(new ServiceDomainMappingNotFoundError({ identifier: input.mappingId })));
			}
			if (mapping.serviceId !== input.serviceId) {
				return yield* Effect.fail(toFailure(new ServiceMappingMismatchError({ mappingId: input.mappingId, serviceId: input.serviceId })));
			}

			const projectDomain = yield* refuse(
				domains.findById(mapping.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(toFailure(new ProjectDomainNotFoundError({ identifier: mapping.projectDomainId })));
			}

			yield* assertAccess(projectDomain.projectId, input.requesterId);

			const allMappings = yield* refuse(
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
						refuse(
							mappings.update(serviceMapping.id, { isPrimary: false }),
						),
					),
			);

			const updated = yield* refuse(
				mappings.update(input.mappingId, { isPrimary: true }),
			);
			if (!updated) {
				return yield* Effect.fail(toFailure(new SetPrimaryDomainError({ serviceId: input.serviceId, mappingId: input.mappingId })));
			}

			const fullUrl = yield* refuse( mappings.getFullUrl(updated.id));
			if (!fullUrl) {
				return yield* Effect.fail(toFailure(new ServiceDomainMappingNotFoundError({ identifier: updated.id })));
			}

			const domain = yield* refuse(
				domains.findById(updated.projectDomainId),
			);
			if (!domain) {
				return yield* Effect.fail(toFailure(new ProjectDomainNotFoundError({ identifier: updated.projectDomainId })));
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
			const mappings = yield* ServiceDomainMappingRepository;
			const domains = yield* ProjectDomainRepository;

			const mapping = yield* refuse( mappings.findById(input.mappingId));
			if (!mapping) {
				return yield* Effect.fail(toFailure(new ServiceDomainMappingNotFoundError({ identifier: input.mappingId })));
			}
			if (mapping.serviceId !== input.serviceId) {
				return yield* Effect.fail(toFailure(new ServiceMappingMismatchError({ mappingId: input.mappingId, serviceId: input.serviceId })));
			}

			const projectDomain = yield* refuse(
				domains.findById(mapping.projectDomainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(toFailure(new ProjectDomainNotFoundError({ identifier: mapping.projectDomainId })));
			}

			yield* assertAccess(projectDomain.projectId, input.requesterId);

			const deleted = yield* refuse( mappings.delete(input.mappingId));
			if (!deleted) {
				return yield* Effect.fail(toFailure(new ServiceDomainMappingDeletionError({ mappingId: input.mappingId })));
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
) {
	/** Resolves the requirements the methods name when the layer is built. */
	static readonly live: DomainServiceServiceShape = new DomainServiceServiceImpl();
}
