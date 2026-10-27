import { beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Stream } from "effect";
import type { Service } from "@deployer/contracts-entities";
import { BadRequestError, ConflictError, NotFoundError } from "@deployer/errors";
import type { ProjectAccessShape } from "@project/core/ports/project-access.port";
import { ProjectAccess } from "@project/core/ports/project-access.port";
import type { RuntimeConfigurationAccessorShape } from "@project/core/ports/runtime-configuration-accessor.port";
import { RuntimeConfigurationAccessor } from "@project/core/ports/runtime-configuration-accessor.port";
import type { ServiceEventServiceShape } from "@project/modules/service/services/service-event.service";
import { DatabasePort } from "@project/core/database/database.port";
import type { ServiceStoreShape } from "../repositories/service.repository";
import { ServiceEventService } from "./service-event.service";
import { ServiceStore } from "../repositories/service.repository";
import type { PreviewTopologyServiceShape } from "./preview-topology.service";
import { PreviewTopologyService } from "./preview-topology.service";
import { DEFAULT_HEALTH_CHECK } from "./service-effective-config";
import { ServiceServiceImpl } from "./service.service";

type Fn = ReturnType<typeof vi.fn>;
type Fakes<T> = { [K in keyof T]: Fn };

const now = "2024-01-01T00:00:00.000Z";

const mockService = (overrides: Partial<Service> = {}): Service =>
	({
		id: "svc-1",
		projectId: "proj-1",
		name: "api",
		description: null,
		type: "application",
		providerId: "manual",
		providerConfig: null,
		builderId: "manual",
		builderConfig: null,
		port: 3000,
		environmentVariables: null,
		resourceLimits: null,
		healthCheckPath: DEFAULT_HEALTH_CHECK.path,
		healthCheckInterval: DEFAULT_HEALTH_CHECK.interval,
		healthCheckTimeout: DEFAULT_HEALTH_CHECK.timeout,
		healthCheckRetries: DEFAULT_HEALTH_CHECK.retries,
		deploymentRetention: null,
		traefikConfig: null,
		customDomains: null,
		isActive: true,
		metadata: null,
		implementations: null,
		implementsContract: null,
		preview: null,
		network: null,
		parentId: null,
		parentPath: null,
		depth: 0,
		createdAt: now,
		updatedAt: now,
		...overrides,
	}) as Service;

const mockDependency = {
	id: "dep-1",
	serviceId: "svc-1",
	dependsOnServiceId: "svc-2",
	dependsOnService: { id: "svc-2", name: "db", type: "database" },
	isRequired: true,
	createdAt: now,
};

describe("ServiceService", () => {
	let service: ServiceServiceImpl;
	let store: Fakes<ServiceStoreShape>;
	let events: Fakes<ServiceEventServiceShape>;
	let access: Fakes<ProjectAccessShape>;
	let configuration: Fakes<RuntimeConfigurationAccessorShape>;
	let topology: Fakes<PreviewTopologyServiceShape>;

	type Deps =
		| ServiceStore
		| ServiceEventService
		| ProjectAccess
		| RuntimeConfigurationAccessor
		| PreviewTopologyService
		| DatabasePort;

	/** Run a use case against the fakes, as the module's Effect context would. */
	const run = <A, E>(effect: Effect.Effect<A, E, Deps>) =>
		Effect.runPromise(
			effect.pipe(
				Effect.provideService(ServiceStore, store as unknown as ServiceStoreShape),
				Effect.provideService(ServiceEventService, events as unknown as ServiceEventServiceShape),
				Effect.provideService(ProjectAccess, access as unknown as ProjectAccessShape),
				Effect.provideService(
					RuntimeConfigurationAccessor,
					configuration as unknown as RuntimeConfigurationAccessorShape,
				),
				Effect.provideService(
					PreviewTopologyService,
					topology as unknown as PreviewTopologyServiceShape,
				),
				Effect.provideService(DatabasePort, { db: {} as never }),
			),
		);

	beforeEach(() => {
		store = {
			list: vi.fn(() => Effect.succeed({ data: [], meta: {} })),
			findById: vi.fn(() => Effect.succeed(null)),
			getProjectSettings: vi.fn(() => Effect.succeed(null)),
			findAncestors: vi.fn(() => Effect.succeed([])),
			create: vi.fn(() => Effect.succeed(mockService())),
			listChildren: vi.fn(() => Effect.succeed([])),
			findWithSubtree: vi.fn(() => Effect.succeed(null)),
			update: vi.fn(() => Effect.succeed(mockService())),
			delete: vi.fn(() => Effect.void),
			toggleActive: vi.fn(() => Effect.succeed(mockService())),
			getDependencies: vi.fn(() => Effect.succeed([])),
			addDependency: vi.fn(() => Effect.succeed(mockDependency)),
			removeDependency: vi.fn(() => Effect.void),
			dependencyExists: vi.fn(() => Effect.succeed(false)),
		};

		events = {
			emitEffect: vi.fn(() => Effect.void),
			subscribeEffect: vi.fn(() => Stream.empty),
		};

		access = { assertProjectAccess: vi.fn(() => Promise.resolve({ id: "proj-1", ownerId: "user-1" })) };

		configuration = {
			resolveStrict: vi.fn(() => ({
				effective: { constraints: { providerAllowed: true, runnerAllowed: true } },
			})),
			projectConfigFromSettings: vi.fn(),
			serviceConfigFromRecord: vi.fn(() => ({}) as never),
		};

		topology = {
			resolve: vi.fn(() =>
				Effect.succeed({ nodes: [], environment: "preview", input: {}, contracts: [] }),
			),
		};

		service = new ServiceServiceImpl();
		vi.clearAllMocks();
	});

	it("should be defined", () => {
		expect(service).toBeDefined();
	});

	// ========================================
	// listServices
	// ========================================

	describe("listServices", () => {
		it("delegates to the store", async () => {
			const result = await run(service.listServices({ limit: 10, offset: 0 }));
			expect(result).toEqual({ data: [], meta: {} });
			expect(store.list).toHaveBeenCalledWith({ limit: 10, offset: 0 });
		});
	});

	// ========================================
	// getServiceById
	// ========================================

	describe("getServiceById", () => {
		it("fails with NotFoundError when the service does not exist", async () => {
			await expect(run(service.getServiceById("svc-1"))).rejects.toBeInstanceOf(NotFoundError);
		});

		it("folds the ancestor chain into effectiveConfig", async () => {
			store.findById = vi.fn(() => Effect.succeed(mockService({ port: null, environmentVariables: { B: "child" } })));
			store.findAncestors = vi.fn(() =>
				Effect.succeed([
					mockService({
						id: "svc-root",
						environmentVariables: { A: "root", B: "root" },
						port: 9000,
					}),
				]),
			);

			const result = await run(service.getServiceById("svc-1"));

			expect(result.effectiveConfig.port).toBe(9000);
			expect(result.effectiveConfig.environmentVariables).toEqual({ A: "root", B: "child" });
		});
	});

	// ========================================
	// createService
	// ========================================

	describe("createService", () => {
		it("checks project access, fills default configs and emits serviceCreated", async () => {
			const created = await run(
				service.createService({ projectId: "proj-1", name: "api", type: "application", providerId: "manual", builderId: "manual" } as never, "user-1"),
			);

			expect(access.assertProjectAccess).toHaveBeenCalledWith("proj-1", "user-1", [
				"owner",
				"maintainer",
				"deployer",
			]);
			expect(store.create).toHaveBeenCalledWith(
				expect.objectContaining({
					providerConfig: expect.anything(),
					builderConfig: expect.anything(),
				}),
			);
			expect(events.emitEffect).toHaveBeenCalledWith(
				"serviceCreated",
				{ projectId: "proj-1" },
				expect.objectContaining({ serviceId: "svc-1" }),
			);
			expect(created.id).toBe("svc-1");
		});

		it("rejects a provider the runtime configuration does not allow", async () => {
			configuration.resolveStrict = vi.fn(() => ({
				effective: { constraints: { providerAllowed: false, runnerAllowed: true } },
			}));

			await expect(
				run(
					service.createService(
						{ projectId: "proj-1", name: "api", type: "application", providerId: "manual", builderId: "manual" } as never,
						"user-1",
					),
				),
			).rejects.toBeInstanceOf(BadRequestError);
			expect(store.create).not.toHaveBeenCalled();
		});
	});

	// ========================================
	// updateService
	// ========================================

	describe("updateService", () => {
		beforeEach(() => {
			store.findById = vi.fn(() => Effect.succeed(mockService()));
		});

		it("rejects making a service its own parent", async () => {
			await expect(
				run(service.updateService("svc-1", { parentId: "svc-1" }, "user-1")),
			).rejects.toBeInstanceOf(BadRequestError);
			expect(store.update).not.toHaveBeenCalled();
		});

		it("rejects moving a service under its own descendant", async () => {
			// The candidate's materialized ancestor chain contains svc-1.
			store.findById = vi.fn((id: string) => Effect.succeed(mockService({ id })));
			store.findAncestors = vi.fn(() => Effect.succeed([mockService({ id: "svc-1" })]));

			await expect(
				run(service.updateService("svc-1", { parentId: "svc-child" }, "user-1")),
			).rejects.toBeInstanceOf(BadRequestError);
			expect(store.update).not.toHaveBeenCalled();
		});

		it("fails with NotFoundError when the update matched nothing", async () => {
			store.update = vi.fn(() => Effect.succeed(null));

			await expect(
				run(service.updateService("svc-1", { name: "renamed" }, "user-1")),
			).rejects.toBeInstanceOf(NotFoundError);
		});
	});

	// ========================================
	// listChildren
	// ========================================

	describe("listChildren", () => {
		it("gives each child the parent's effective config", async () => {
			const parent = mockService({ environmentVariables: { SHARED: "yes" }, port: 3000 });
			store.findById = vi.fn(() => Effect.succeed(parent));
			store.listChildren = vi.fn(() =>
				Effect.succeed([mockService({ id: "svc-2", parentId: "svc-1", port: null })]),
			);

			const result = await run(service.listChildren("svc-1", "user-1"));

			expect(result.children[0]?.effectiveConfig.port).toBe(3000);
			expect(result.children[0]?.effectiveConfig.environmentVariables).toEqual({ SHARED: "yes" });
		});
	});

	// ========================================
	// deleteService / toggleActive
	// ========================================

	describe("deleteService", () => {
		it("deletes and emits serviceDeleted", async () => {
			store.findById = vi.fn(() => Effect.succeed(mockService()));

			await run(service.deleteService("svc-1", "user-1"));

			expect(store.delete).toHaveBeenCalledWith("svc-1");
			expect(events.emitEffect).toHaveBeenCalledWith(
				"serviceDeleted",
				{ serviceId: "svc-1" },
				expect.objectContaining({ projectId: "proj-1" }),
			);
		});
	});

	describe("toggleActive", () => {
		it("fails with NotFoundError when the row disappeared", async () => {
			store.findById = vi.fn(() => Effect.succeed(mockService()));
			store.toggleActive = vi.fn(() => Effect.succeed(null));

			await expect(run(service.toggleActive("svc-1", false, "user-1"))).rejects.toBeInstanceOf(
				NotFoundError,
			);
		});
	});

	// ========================================
	// Dependencies
	// ========================================

	describe("addDependency", () => {
		beforeEach(() => {
			store.findById = vi.fn((id: string) => Effect.succeed(mockService({ id })));
		});

		it("rejects a self dependency", async () => {
			await expect(
				run(service.addDependency("svc-1", "svc-1", true, "user-1")),
			).rejects.toBeInstanceOf(BadRequestError);
			expect(store.addDependency).not.toHaveBeenCalled();
		});

		it("rejects a duplicate edge", async () => {
			store.dependencyExists = vi.fn(() => Effect.succeed(true));

			await expect(
				run(service.addDependency("svc-1", "svc-2", true, "user-1")),
			).rejects.toBeInstanceOf(ConflictError);
			expect(store.addDependency).not.toHaveBeenCalled();
		});

		it("creates the edge and emits serviceDependencyAdded", async () => {
			const created = await run(service.addDependency("svc-1", "svc-2", true, "user-1"));

			expect(store.addDependency).toHaveBeenCalledWith("svc-1", "svc-2", true);
			expect(events.emitEffect).toHaveBeenCalledWith(
				"serviceDependencyAdded",
				{ serviceId: "svc-1" },
				expect.objectContaining({ dependsOnServiceId: "svc-2", isRequired: true }),
			);
			expect(created.id).toBe("dep-1");
		});
	});

	describe("getDependencies", () => {
		it("returns the edges plus the sub-service tree", async () => {
			store.findById = vi.fn((id: string) => Effect.succeed(mockService({ id })));
			store.getDependencies = vi.fn(() => Effect.succeed([mockDependency]));
			store.listChildren = vi.fn((parentId: string) =>
				Effect.succeed(parentId === "svc-1" ? [mockService({ id: "svc-3", name: "worker" })] : []),
			);

			const result = await run(service.getDependencies("svc-1"));

			expect(result.dependencies).toEqual([mockDependency]);
			expect(result.subServices).toEqual([
				expect.objectContaining({ serviceId: "svc-3", serviceName: "worker" }),
			]);
		});
	});

	// ========================================
	// resolvePreviewTopology
	// ========================================

	describe("resolvePreviewTopology", () => {
		it("checks access then delegates to the topology service", async () => {
			store.findById = vi.fn(() => Effect.succeed(mockService()));

			const result = await run(
				service.resolvePreviewTopology("svc-1", "user-1", { environment: "preview" }),
			);

			expect(topology.resolve).toHaveBeenCalledWith("svc-1", { environment: "preview" });
			expect(result.environment).toBe("preview");
		});
	});
});
