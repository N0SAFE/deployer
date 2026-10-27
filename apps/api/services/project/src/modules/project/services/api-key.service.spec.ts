import { describe, it, expect, beforeEach, vi } from "vitest";
import { Effect } from "effect";
import { ConflictError, ForbiddenError, NotFoundError } from "@deployer/errors";
import type { ApiKeyStoreShape } from "../repositories/api-key.repository";
import { ApiKeyStore } from "../repositories/api-key.repository";
import type { ProjectStoreShape } from "../repositories/project.repository";
import { ProjectStore } from "../repositories/project.repository";
import { DatabasePort } from "@project/core/database/database.port";
import { ApiKeyServiceImpl } from "./api-key.service";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockProject = { id: "proj-1", ownerId: "user-1", name: "Test" };
const mockKeyRecord = {
	id: "key-1",
	userId: "user-1",
	name: "My Key",
	keyHash: "abc123",
	keyPreview: "dk_deadbeef",
	projectId: null,
	scopes: ["deploy", "read"],
	lastUsed: null,
	expiresAt: null,
	isActive: true,
	createdAt: new Date(),
	updatedAt: new Date(),
};

type Fn = ReturnType<typeof vi.fn>;
type Fakes<T> = { [K in keyof T]: Fn };

describe("ApiKeyService", () => {
	let service: ApiKeyServiceImpl;
	let keys: Fakes<ApiKeyStoreShape>;
	let projects: Pick<Fakes<ProjectStoreShape>, "findById" | "findCollaboratorByUserAndProject">;

	type Deps = ApiKeyStore | ProjectStore | DatabasePort;

	/** Run a use case against the fakes, as the module's Effect context would. */
	const run = <A, E>(effect: Effect.Effect<A, E, Deps>) =>
		Effect.runPromise(
			effect.pipe(
				Effect.provideService(ApiKeyStore, keys as unknown as ApiKeyStoreShape),
				Effect.provideService(ProjectStore, projects as unknown as ProjectStoreShape),
				Effect.provideService(DatabasePort, { db: {} as never }),
			),
		);

	beforeEach(() => {
		keys = {
			findById: vi.fn(() => Effect.succeed(null)),
			findByHash: vi.fn(() => Effect.succeed(null)),
			findByUser: vi.fn(() => Effect.succeed([])),
			findByProject: vi.fn(() => Effect.succeed([])),
			create: vi.fn(() => Effect.succeed(mockKeyRecord)),
			setActive: vi.fn(() => Effect.succeed(mockKeyRecord)),
			touchLastUsed: vi.fn(() => Effect.void),
			delete: vi.fn(() => Effect.void),
		};

		projects = {
			findById: vi.fn(() => Effect.succeed(null)),
			findCollaboratorByUserAndProject: vi.fn(() => Effect.succeed(null)),
		};

		service = new ApiKeyServiceImpl();
		vi.clearAllMocks();
	});

	it("should be defined", () => {
		expect(service).toBeDefined();
	});

	// -----------------------------------------------------------------------
	// createApiKey
	// -----------------------------------------------------------------------

	describe("createApiKey", () => {
		it("should create a key and return rawKey once for the owning user", async () => {
			const result = await run(service.createApiKey({ userId: "user-1", name: "My Key" }));

			expect(result.rawKey).toMatch(/^dk_[0-9a-f]{64}$/);
			expect(result.keyPreview).toBe(mockKeyRecord.keyPreview);
			expect(keys.create).toHaveBeenCalledOnce();
			const createArg = keys.create.mock.calls[0]?.[0];
			// Raw key must NOT be stored plain
			expect(createArg?.keyHash).not.toBe(result.rawKey);
			expect(createArg?.keyHash).toHaveLength(64); // SHA-256 hex
		});

		it("should validate project access when projectId is given", async () => {
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			keys.create.mockReturnValue(Effect.succeed({ ...mockKeyRecord, projectId: "proj-1" }));

			const result = await run(
				service.createApiKey({
					userId: "user-1",
					name: "Project Key",
					projectId: "proj-1",
				}),
			);

			expect(result.rawKey).toBeDefined();
			expect(projects.findById).toHaveBeenCalledWith("proj-1");
		});

		it("should throw ForbiddenError if non-admin requests project key", async () => {
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			projects.findCollaboratorByUserAndProject.mockReturnValue(
				Effect.succeed({ role: "developer" }),
			);

			await expect(
				run(service.createApiKey({ userId: "dev-user", name: "Key", projectId: "proj-1" })),
			).rejects.toThrow(ForbiddenError);
		});

		it("should throw ConflictError on key hash collision", async () => {
			keys.findByHash.mockReturnValue(Effect.succeed(mockKeyRecord)); // hash already exists

			await expect(
				run(service.createApiKey({ userId: "user-1", name: "Key" })),
			).rejects.toThrow(ConflictError);
		});
	});

	// -----------------------------------------------------------------------
	// revokeApiKey
	// -----------------------------------------------------------------------

	describe("revokeApiKey", () => {
		it("should revoke own key", async () => {
			keys.findById.mockReturnValue(Effect.succeed(mockKeyRecord));

			await run(service.revokeApiKey("key-1", "user-1"));

			expect(keys.setActive).toHaveBeenCalledWith("key-1", false);
		});

		it("should throw NotFoundError for unknown key", async () => {
			await expect(run(service.revokeApiKey("bad-id", "user-1"))).rejects.toThrow(
				NotFoundError,
			);
		});

		it("should throw ForbiddenError when another user owns the key and no project", async () => {
			keys.findById.mockReturnValue(
				Effect.succeed({ ...mockKeyRecord, userId: "other-user", projectId: null }),
			);

			await expect(run(service.revokeApiKey("key-1", "user-1"))).rejects.toThrow(
				ForbiddenError,
			);
		});

		it("should allow project admin to revoke a project-scoped key", async () => {
			keys.findById.mockReturnValue(
				Effect.succeed({
					...mockKeyRecord,
					userId: "other-user",
					projectId: "proj-1",
				}),
			);
			projects.findById.mockReturnValue(Effect.succeed(mockProject));
			// user-1 is project owner, which also grants admin

			await run(service.revokeApiKey("key-1", "user-1"));

			expect(keys.setActive).toHaveBeenCalledWith("key-1", false);
		});
	});

	// -----------------------------------------------------------------------
	// rotateApiKey
	// -----------------------------------------------------------------------

	describe("rotateApiKey", () => {
		it("should revoke old key and issue a new one", async () => {
			keys.findById.mockReturnValue(Effect.succeed(mockKeyRecord));
			keys.create.mockReturnValue(
				Effect.succeed({ ...mockKeyRecord, id: "key-2", keyHash: "newHash" }),
			);

			const result = await run(service.rotateApiKey("key-1", "user-1"));

			expect(result.revokedKeyId).toBe("key-1");
			expect(result.newKey.rawKey).toMatch(/^dk_[0-9a-f]{64}$/);
			expect(keys.setActive).toHaveBeenCalledWith("key-1", false);
			expect(keys.create).toHaveBeenCalledOnce();
		});

		it("should throw NotFoundError when key not found", async () => {
			await expect(run(service.rotateApiKey("bad-id", "user-1"))).rejects.toThrow(
				NotFoundError,
			);
		});

		it("should throw ForbiddenError for unauthorized rotate", async () => {
			keys.findById.mockReturnValue(
				Effect.succeed({ ...mockKeyRecord, userId: "other-user", projectId: null }),
			);

			await expect(run(service.rotateApiKey("key-1", "user-1"))).rejects.toThrow(
				ForbiddenError,
			);
		});
	});
});
