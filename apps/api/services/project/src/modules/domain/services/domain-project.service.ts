import { DomainAdapter } from "@deployer/shared/core/modules/domain/adapters/domain.adapter";
import {
	ProjectDomainDeletionError,
	ProjectDomainNotFoundError,
	ProjectDomainUpdateError,
} from "@deployer/shared/core/modules/domain/errors/index";
import { DomainAlreadyExistsError } from "@deployer/shared/core/modules/domain/errors/domain-errors";
import { attempt } from "@project/core/effect/attempt";
import { DomainVerification } from "@project/core/ports/domain-verification.port";
import { ProjectAccess } from "@project/core/ports/project-access.port";
import { ProjectDomainRepo } from "@project/core/ports/project-domain-repository.port";
import { ServiceDomainMappingRepo } from "@project/core/ports/service-domain-mapping-repository.port";
import { Context, Effect } from "effect";

export type AddProjectDomainInput = {
	readonly projectId: string;
	readonly domain: string;
	readonly verificationMethod: "txt_record" | "cname_record";
	readonly allowedSubdomains: string[];
	readonly isPrimary: boolean;
};

export type UpdateProjectDomainInput = {
	readonly domainId: string;
	readonly allowedSubdomains?: string[];
	readonly isPrimary?: boolean;
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

/** The project-domain use cases, composed as Effects over the shared tables. */
export class DomainProjectServiceImpl {
	addProjectDomain(input: AddProjectDomainInput, requesterId: string) {
		return Effect.gen(function* () {
			yield* assertAccess(input.projectId, requesterId);

			const domains = yield* ProjectDomainRepo;
			const existing = yield* attempt(() =>
				domains.findByProjectAndDomain(input.projectId, input.domain),
			);
			if (existing) {
				return yield* Effect.fail(
					new DomainAlreadyExistsError(input.projectId, input.domain),
				);
			}

			const verificationToken = crypto.randomUUID().replace(/-/g, "");
			const projectDomain = yield* attempt(() =>
				domains.create({
					projectId: input.projectId,
					domain: input.domain,
					verificationMethod: input.verificationMethod,
					verificationToken,
					dnsRecordChecked: false,
					verificationStatus: "pending",
					allowedSubdomains: input.allowedSubdomains,
					isPrimary: input.isPrimary,
				}),
			);

			const recordName =
				input.verificationMethod === "cname_record"
					? `_deployer.${input.domain}`
					: "_deployer-challenge";
			const recordValue =
				input.verificationMethod === "cname_record"
					? `verify.deployer.${verificationToken}.acme.`
					: `deployer-verification=${verificationToken}`;

			const contract = DomainAdapter.toProjectDomainContract(projectDomain);
			const verificationInstructions = {
				method: input.verificationMethod,
				recordName,
				recordValue,
				instructions: `Create a ${input.verificationMethod.toUpperCase()} record: name "${recordName}" -> value "${recordValue}", then verify.`,
			};

			return {
				projectDomain: { ...contract, verificationInstructions },
				verificationInstructions,
				suggestions: {
					commonSubdomains: ["api", "www", "app", "admin", "staging"],
					wildcardOption: "*",
				},
			};
		});
	}

	listProjectDomains(input: { readonly projectId: string }) {
		return Effect.gen(function* () {
			const domains = yield* ProjectDomainRepo;
			const projectDomains = yield* attempt(() =>
				domains.findByProjectId(input.projectId),
			);
			return projectDomains.map((projectDomain) =>
				DomainAdapter.toProjectDomainContract(projectDomain),
			);
		});
	}

	getAvailableDomains(input: { readonly projectId: string }) {
		return Effect.gen(function* () {
			const domains = yield* ProjectDomainRepo;
			const mappings = yield* ServiceDomainMappingRepo;

			const availableDomains = yield* attempt(() =>
				domains.getAvailableDomainsForProject(input.projectId),
			);

			return yield* Effect.all(
				availableDomains.map((availableDomain) =>
					Effect.gen(function* () {
						const alreadySelected = yield* attempt(() =>
							mappings.hasProjectDomainMappings(availableDomain.id),
						);
						return {
							id: availableDomain.id,
							domain: availableDomain.domain,
							verificationStatus: "verified" as const,
							verifiedAt: availableDomain.verifiedAt,
							alreadySelected,
						};
					}),
				),
			);
		});
	}

	getAvailableDomainsForService(input: {
		readonly projectId: string;
		readonly serviceId?: string;
	}) {
		return Effect.gen(function* () {
			const domains = yield* ProjectDomainRepo;
			const mappings = yield* ServiceDomainMappingRepo;

			const projectDomains = yield* attempt(() =>
				domains.findByProjectId(input.projectId),
			);

			return yield* Effect.all(
				projectDomains.map((projectDomain) =>
					Effect.gen(function* () {
						const domainMappings = yield* attempt(() =>
							mappings.findByProjectDomainId(projectDomain.id),
						);

						const existingMappings = yield* Effect.all(
							domainMappings
								.filter(
									(mapping) =>
										!input.serviceId || mapping.serviceId !== input.serviceId,
								)
								.map((mapping) =>
									Effect.gen(function* () {
										const fullUrl = yield* attempt(() =>
											mappings.getFullUrl(mapping.id),
										);
										return {
											serviceId: mapping.serviceId,
											serviceName: mapping.serviceId,
											subdomain: mapping.subdomain,
											basePath: mapping.basePath,
											fullUrl: fullUrl ?? "",
										};
									}),
								),
						);

						return {
							projectDomainId: projectDomain.id,
							domain: projectDomain.domain,
							allowedSubdomains: projectDomain.allowedSubdomains,
							isPrimary: projectDomain.isPrimary,
							existingMappings,
						};
					}),
				),
			);
		});
	}

	updateProjectDomain(input: UpdateProjectDomainInput, requesterId: string) {
		return Effect.gen(function* () {
			const domains = yield* ProjectDomainRepo;

			const projectDomain = yield* attempt(() =>
				domains.findById(input.domainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(new ProjectDomainNotFoundError(input.domainId));
			}

			yield* assertAccess(projectDomain.projectId, requesterId);

			const updated = yield* attempt(() =>
				domains.update(input.domainId, {
					...(input.allowedSubdomains !== undefined
						? { allowedSubdomains: input.allowedSubdomains }
						: {}),
					...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {}),
				}),
			);
			if (!updated) {
				return yield* Effect.fail(new ProjectDomainUpdateError(input.domainId));
			}

			return DomainAdapter.toProjectDomainContract(updated);
		});
	}

	verifyProjectDomain(input: {
		readonly projectId: string;
		readonly domainId: string;
		readonly requesterId: string;
	}) {
		return Effect.gen(function* () {
			yield* assertAccess(input.projectId, input.requesterId);

			const verification = yield* DomainVerification;
			return yield* attempt(() =>
				verification.verifyProjectDomain(input.projectId, input.domainId),
			);
		});
	}

	removeProjectDomain(input: {
		readonly domainId: string;
		readonly requesterId: string;
	}) {
		return Effect.gen(function* () {
			const domains = yield* ProjectDomainRepo;
			const mappings = yield* ServiceDomainMappingRepo;

			const projectDomain = yield* attempt(() =>
				domains.findById(input.domainId),
			);
			if (!projectDomain) {
				return yield* Effect.fail(new ProjectDomainNotFoundError(input.domainId));
			}

			yield* assertAccess(projectDomain.projectId, input.requesterId);

			const affectedServices = yield* attempt(() =>
				mappings.countByProjectDomainId(input.domainId),
			);
			const deleted = yield* attempt(() => domains.delete(input.domainId));
			if (!deleted) {
				return yield* Effect.fail(new ProjectDomainDeletionError(input.domainId));
			}

			return {
				success: true,
				message: "Domain removed from project successfully",
				affectedServices,
			};
		});
	}
}

/** The service's public surface is exactly the implementation's methods. */
export type DomainProjectServiceShape = DomainProjectServiceImpl;

/** Effect key = NestJS token. */
export class DomainProjectService extends Context.Service<DomainProjectService, DomainProjectServiceShape>()(
	"project/DomainProjectService",
) {}
