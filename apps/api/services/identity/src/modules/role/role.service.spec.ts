import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actor, CurrentActor } from "@deployer/effect-core";
import { ForbiddenError } from "@deployer/errors";

import { DatabasePort } from "@identity/core/database/database.port";
import { AuditService } from "@identity/modules/audit/audit.service";
import { StepUpService } from "@identity/modules/step-up/step-up.service";

import { RoleForbidden, RoleInvalid } from "./role.errors";
import { RoleRepository, type RoleRepositoryShape, type RoleRow } from "./role.repository";
import { RoleService } from "./role.service";

const roleRow = (overrides: Partial<RoleRow> = {}): RoleRow => ({
	id: "role-1",
	name: "admin",
	scope: "platform",
	rank: 2,
	label: "Admin",
	description: null,
	color: null,
	isSystem: true,
	permissions: ["role:read"],
	...overrides,
});

describe("RoleService", () => {
	const repo = {
		list: vi.fn(),
		findById: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		countUsersWithRole: vi.fn(),
		isKnownPlatformRole: vi.fn(),
		seed: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		repo.list.mockImplementation(() => Effect.succeed([roleRow()]));
		repo.isKnownPlatformRole.mockImplementation(() => Effect.succeed(false));
		repo.create.mockImplementation(() => Effect.succeed(roleRow({ id: "new", isSystem: false, name: "auditor" })));
		repo.update.mockImplementation(() => Effect.succeed(roleRow({ id: "role-2", isSystem: false })));
		repo.delete.mockImplementation(() => Effect.void);
		repo.countUsersWithRole.mockImplementation(() => Effect.succeed(0));
	});

	/** The service over a fake repository, run as one actor. */
	const run = <A, E>(
		actor: Actor,
		use: (roles: RoleService["Service"]) => Effect.Effect<
			A,
			E,
			RoleRepository | CurrentActor | DatabasePort | AuditService | StepUpService
		>,
		stepUp: "ok" | "missing" = "ok",
	): Effect.Effect<A, E> =>
		Effect.gen(function* () {
			const roles = yield* RoleService;
			return yield* use(roles);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(RoleService, RoleService.live as unknown as RoleService["Service"]),
					Layer.succeed(RoleRepository, repo as unknown as RoleRepositoryShape),
					Layer.succeed(CurrentActor, actor),
					Layer.succeed(DatabasePort, {} as never),
					Layer.succeed(AuditService, { record: () => Effect.void } as unknown as AuditService["Service"]),
					Layer.succeed(StepUpService, {
						assertCritical: () =>
							stepUp === "ok" ? Effect.void : Effect.fail(new ForbiddenError("step-up required")),
						status: () => Effect.die(new Error("unused")),
					} as unknown as StepUpService["Service"]),
				),
			),
		);

	it("refuses an actor without `role:read`", async () => {
		const outcome = await Effect.runPromise(Effect.flip(run(Actor.user("u1", "user"), (r) => r.list(undefined))));

		expect(outcome).toBeInstanceOf(RoleForbidden);
		expect(repo.list).not.toHaveBeenCalled();
	});

	it("returns the catalogue for an actor holding `role:read`, scoped when asked", async () => {
		const rows = await Effect.runPromise(run(Actor.user("u2", "viewer"), (r) => r.list("platform")));

		expect(rows).toEqual([roleRow()]);
		expect(repo.list).toHaveBeenCalledWith("platform");
	});

	describe("create", () => {
		const body = {
			name: "auditor",
			rank: 1,
			label: "Auditor",
			description: null,
			color: null,
			permissions: ["audit:read"],
		};

		it("refuses an actor without `role:write`", async () => {
			const outcome = await Effect.runPromise(Effect.flip(run(Actor.user("u1", "operator"), (r) => r.create(body))));

			expect(outcome).toBeInstanceOf(RoleForbidden);
			expect(repo.create).not.toHaveBeenCalled();
		});

		it("refuses a rank at or above the creator's", async () => {
			const outcome = await Effect.runPromise(
				Effect.flip(run(Actor.user("a1", "admin"), (r) => r.create({ ...body, rank: 2 }))),
			);

			expect(outcome).toBeInstanceOf(RoleForbidden);
		});

		it("refuses a permission the creator does not hold", async () => {
			// `admin` holds platform-admin but not the danger bundle, so a reveal permission is outside its capabilities.
			const outcome = await Effect.runPromise(
				Effect.flip(run(Actor.user("a1", "admin"), (r) => r.create({ ...body, permissions: ["platform.secret:reveal"] }))),
			);

			expect(outcome).toBeInstanceOf(RoleForbidden);
			expect(repo.create).not.toHaveBeenCalled();
		});

		it("refuses a name that already exists", async () => {
			repo.isKnownPlatformRole.mockImplementation(() => Effect.succeed(true));

			const outcome = await Effect.runPromise(Effect.flip(run(Actor.user("a1", "admin"), (r) => r.create(body))));

			expect(outcome).toBeInstanceOf(RoleInvalid);
		});

		it("refuses to create a role without a fresh passkey proof", async () => {
			const outcome = await Effect.runPromise(
				Effect.flip(run(Actor.user("a1", "admin"), (r) => r.create(body), "missing")),
			);

			expect(outcome).toBeInstanceOf(RoleForbidden);
			expect(repo.create).not.toHaveBeenCalled();
		});

		it("creates a custom role below the creator's rank with permissions it holds", async () => {
			const created = await Effect.runPromise(run(Actor.user("a1", "admin"), (r) => r.create(body)));

			expect(created.name).toBe("auditor");
			expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({ name: "auditor", isSystem: false, scope: "platform" }));
		});
	});

	it("refuses to edit a built-in role", async () => {
		repo.findById.mockImplementation(() => Effect.succeed(roleRow({ isSystem: true })));

		const outcome = await Effect.runPromise(
			Effect.flip(run(Actor.user("a1", "superAdmin"), (r) => r.update("role-1", { label: "Nope" }))),
		);

		expect(outcome).toBeInstanceOf(RoleForbidden);
	});

	it("refuses to delete a role an account still holds", async () => {
		repo.findById.mockImplementation(() => Effect.succeed(roleRow({ id: "role-2", isSystem: false, name: "auditor" })));
		repo.countUsersWithRole.mockImplementation(() => Effect.succeed(2));

		const outcome = await Effect.runPromise(
			Effect.flip(run(Actor.user("a1", "admin"), (r) => r.remove("role-2"))),
		);

		expect(outcome).toBeInstanceOf(RoleInvalid);
		expect(repo.delete).not.toHaveBeenCalled();
	});

	it("deletes an unused custom role", async () => {
		repo.findById.mockImplementation(() => Effect.succeed(roleRow({ id: "role-2", isSystem: false, name: "auditor" })));

		await Effect.runPromise(run(Actor.user("a1", "admin"), (r) => r.remove("role-2")));

		expect(repo.delete).toHaveBeenCalledWith("role-2");
	});
});
