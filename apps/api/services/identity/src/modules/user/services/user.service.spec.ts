import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actor, Correlation, CurrentActor } from "@deployer/effect-core";

import { EmailTaken, UserForbidden, UserInvalid, UserNotFound } from "../domain/user.errors";
import { ForbiddenError } from "@deployer/errors";

import { DatabasePort } from "@identity/core/database/database.port";
import { StepUpService } from "@identity/modules/step-up/step-up.service";

import { UserRepository, type UserRepositoryShape } from "../repositories/user.repository";

import { UserService, type UserFailure, type UserServiceShape } from "./user.service";

import type { User } from "../domain/user.types";

const admin = { userId: "admin-1", role: "admin" };
const root = { userId: "root-1", role: "superAdmin" };
const member = { userId: "user-1", role: "user" };

const userRow = (overrides: Partial<User> = {}): User =>
	({ id: "user-1", name: "Ada", email: "ada@example.com", role: "viewer", banned: false, ...overrides }) as User;

/** A repository whose every call is a spy returning a succeeded Effect. */
function makeRepository() {
	const repo = {
		findById: vi.fn(),
		findByEmail: vi.fn(),
		emailExists: vi.fn(),
		list: vi.fn(),
		count: vi.fn(),
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		revokeCredentials: vi.fn(),
	};
	for (const fn of Object.values(repo)) fn.mockImplementation(() => Effect.succeed(undefined));
	return repo;
}

describe("UserService", () => {
	let repo: ReturnType<typeof makeRepository>;

	beforeEach(() => {
		repo = makeRepository();
	});

	type Acting = { userId: string; role: string };
	type ActingService = {
		[K in keyof UserServiceShape]: UserServiceShape[K] extends (...args: infer P) => Effect.Effect<infer A, infer E, any>
			? (actor: Acting, ...args: P) => Effect.Effect<A, E>
			: never;
	};

	/** The service over the fake repository; each call names the actor it runs as. */
	const service = new Proxy({} as ActingService, {
		get:
			(_target, key: keyof UserServiceShape) =>
			(actor: Acting, ...args: unknown[]) => {
				const method = UserService.live[key] as (
					...a: unknown[]
				) => Effect.Effect<unknown, UserFailure, UserRepository | CurrentActor | Correlation | StepUpService>;
				return method(...args).pipe(
					Effect.provideService(UserRepository, repo as unknown as UserRepositoryShape),
					Effect.provideService(CurrentActor, Actor.user(actor.userId, actor.role)),
					Effect.provideService(Correlation, { id: "test" }),
					// The passkey proof is AUTH-062's concern and has its own spec; here every call is stepped up.
					Effect.provideService(StepUpService, {
						assertCritical: () => Effect.void,
						status: () => Effect.die(new Error("status is not used by UserService")),
					} as unknown as StepUpService["Service"]),
				);
			},
	});

	const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

	/** The domain error a use case failed with. */
	const failureOf = (effect: Effect.Effect<unknown, UserFailure>) => run(Effect.flip(effect));

	describe("critical actions", () => {
		it("refuses a role change when the session has no fresh passkey proof", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow({ role: "user" })));

			const effect = UserService.live.setRole("user-1", "admin").pipe(
				Effect.provideService(UserRepository, repo as unknown as UserRepositoryShape),
				Effect.provideService(CurrentActor, Actor.user("admin-1", "superAdmin")),
				Effect.provideService(Correlation, { id: "test" }),
				Effect.provideService(DatabasePort, {} as never),
				Effect.provideService(StepUpService, {
					assertCritical: () => Effect.fail(new ForbiddenError("step-up required")),
					status: () => Effect.die(new Error("unused")),
				} as unknown as StepUpService["Service"]),
			);

			await expect(Effect.runPromise(Effect.flip(effect))).resolves.toBeInstanceOf(UserForbidden);
			expect(repo.update).not.toHaveBeenCalled();
		});
	});

	describe("list / count", () => {
		it("forbids an ordinary user", async () => {
			const query = { limit: 10, offset: 0, sortField: "createdAt", sortDirection: "desc", filter: {} } as const;

			await expect(failureOf(service.list(member, query))).resolves.toBeInstanceOf(UserForbidden);
			await expect(failureOf(service.count(member, {}))).resolves.toBeInstanceOf(UserForbidden);
			expect(repo.list).not.toHaveBeenCalled();
		});

		it("pages with the query's filter, limit, offset and sort for an admin", async () => {
			repo.list.mockReturnValue(Effect.succeed({ data: [userRow()], total: 1 }));

			const page = await run(
				service.list(admin, {
					limit: 10,
					offset: 20,
					sortField: "name",
					sortDirection: "asc",
					filter: { name: { operator: "like", value: "Ad" } },
				}),
			);

			expect(page.total).toBe(1);
			expect(repo.list).toHaveBeenCalledWith({
				name: { operator: "like", value: "Ad" },
				limit: 10,
				offset: 20,
				sortField: "name",
				sortDirection: "asc",
			});
		});
	});

	describe("findById", () => {
		it("lets a user read themselves", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow()));

			await expect(run(service.findById(member, "user-1"))).resolves.toMatchObject({ id: "user-1" });
		});

		it("forbids a user reading someone else, without touching the database", async () => {
			await expect(failureOf(service.findById(member, "user-2"))).resolves.toBeInstanceOf(UserForbidden);
			expect(repo.findById).not.toHaveBeenCalled();
		});

		it("returns null for an unknown id when an admin asks", async () => {
			repo.findById.mockReturnValue(Effect.succeed(null));

			await expect(run(service.findById(admin, "ghost"))).resolves.toBeNull();
		});
	});

	describe("checkEmail", () => {
		it("checks the normalised address", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(true));

			await expect(run(service.checkEmail(member, "  Ada@Example.COM "))).resolves.toBe(true);
			expect(repo.emailExists).toHaveBeenCalledWith("ada@example.com");
		});
	});

	describe("create", () => {
		it("inserts a trimmed name and a normalised email", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(false));
			repo.insert.mockImplementation((input: unknown) => Effect.succeed(input));

			await run(service.create(admin, { name: "  Ada ", email: " Ada@Example.com " }));

			expect(repo.insert).toHaveBeenCalledWith({ name: "Ada", email: "ada@example.com" });
		});

		it("passes an image and a role through when given", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(false));
			repo.insert.mockImplementation((input: unknown) => Effect.succeed(input));

			await run(service.create(admin, { name: "Ada", email: "a@b.co", image: "i.png", role: "viewer" }));

			expect(repo.insert).toHaveBeenCalledWith({ name: "Ada", email: "a@b.co", image: "i.png", role: "viewer" });
		});

		it("forbids a non-administrator", async () => {
			await expect(failureOf(service.create(member, { name: "A", email: "a@b.co" }))).resolves.toBeInstanceOf(
				UserForbidden,
			);
		});

		it("forbids an admin granting superAdmin, but lets a superAdmin", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(false));
			repo.insert.mockImplementation((input: unknown) => Effect.succeed(input));
			const input = { name: "Root", email: "r@b.co", role: "superAdmin" } as const;

			await expect(failureOf(service.create(admin, input))).resolves.toBeInstanceOf(UserForbidden);
			await expect(run(service.create(root, input))).resolves.toMatchObject({ role: "superAdmin" });
		});

		it("rejects an unusable email or a blank name before the database", async () => {
			await expect(failureOf(service.create(admin, { name: "A", email: "nope" }))).resolves.toBeInstanceOf(
				UserInvalid,
			);
			await expect(failureOf(service.create(admin, { name: " ", email: "a@b.co" }))).resolves.toBeInstanceOf(
				UserInvalid,
			);
			expect(repo.emailExists).not.toHaveBeenCalled();
		});

		it("conflicts when the email is taken", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(true));

			await expect(failureOf(service.create(admin, { name: "A", email: "a@b.co" }))).resolves.toBeInstanceOf(
				EmailTaken,
			);
			expect(repo.insert).not.toHaveBeenCalled();
		});
	});

	describe("update", () => {
		beforeEach(() => {
			repo.findById.mockReturnValue(Effect.succeed(userRow()));
			repo.emailExists.mockReturnValue(Effect.succeed(false));
			repo.update.mockImplementation((id: string, patch: object) => Effect.succeed(userRow({ id, ...patch })));
		});

		it("refuses client-supplied audit timestamps before anything else", async () => {
			await expect(
				failureOf(service.update(admin, "user-1", { name: "X" }, { createdAt: "2026-01-01" })),
			).resolves.toBeInstanceOf(UserInvalid);
			expect(repo.findById).not.toHaveBeenCalled();
		});

		it("answers not found for an unknown user", async () => {
			repo.findById.mockReturnValue(Effect.succeed(null));

			await expect(failureOf(service.update(admin, "ghost", { name: "X" }, {}))).resolves.toBeInstanceOf(
				UserNotFound,
			);
		});

		it("forbids changing someone else's account without administration", async () => {
			await expect(failureOf(service.update(member, "user-2", { name: "X" }, {}))).resolves.toBeInstanceOf(
				UserForbidden,
			);
		});

		it("narrows a self-update to name and email, ignoring fields a user may not change", async () => {
			// `role` equal to the current one is not a change, so it is dropped rather than refused.
			await run(service.update(member, "user-1", { name: " Ada L. ", role: "viewer" }, {}));

			expect(repo.update).toHaveBeenCalledWith("user-1", { name: "Ada L." });
		});

		it("refuses a self-ban, through the update path or the dedicated one", async () => {
			await expect(failureOf(service.update(admin, "admin-1", { banned: true }, {}))).resolves.toBeInstanceOf(
				UserForbidden,
			);
			expect(repo.update).not.toHaveBeenCalled();

			await expect(failureOf(service.setBanned(admin, "admin-1", true))).resolves.toBeInstanceOf(UserForbidden);
		});

		it("refuses a user who asks to change their own role", async () => {
			await expect(failureOf(service.update(member, "user-1", { role: "admin" }, {}))).resolves.toBeInstanceOf(
				UserForbidden,
			);
			expect(repo.update).not.toHaveBeenCalled();
		});

		it("lets an admin change a role, but never to its own rank or above", async () => {
			await run(service.update(admin, "user-1", { role: "viewer" }, {}));
			expect(repo.update).toHaveBeenCalledWith("user-1", { role: "viewer" });

			// `>=` is refused, not just `>`: an admin minting another admin is the same escalation as minting a
			// superAdmin one step later, and the hierarchy rule is shared with Better Auth's admin endpoints.
			await expect(
				failureOf(service.update(admin, "user-1", { role: "admin" }, {})),
			).resolves.toBeInstanceOf(UserForbidden);
			await expect(
				failureOf(service.update(admin, "user-1", { role: "superAdmin" }, {})),
			).resolves.toBeInstanceOf(UserForbidden);
		});

		it("lets a superAdmin grant any role, including its own", async () => {
			await run(service.update(root, "user-1", { role: "admin" }, {}));
			expect(repo.update).toHaveBeenCalledWith("user-1", { role: "admin" });

			expect(repo.update).toHaveBeenCalledTimes(1);
			await run(service.update(root, "user-2", { role: "superAdmin" }, {}));
		});

		it("ends the target's sessions after a role change, so the new role applies now", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow({ role: "viewer" })));

			await run(service.update(admin, "user-1", { role: "operator" }, {}));

			expect(repo.revokeCredentials).toHaveBeenCalledWith("user-1");
		});

		it("leaves the sessions alone when the patch changes no credential", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow({ role: "viewer" })));

			await run(service.update(root, "user-1", { name: "Ada Lovelace" }, {}));

			expect(repo.revokeCredentials).not.toHaveBeenCalled();
		});

		it("conflicts on an email another account holds, checking it excluding this user", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(true));

			await expect(
				failureOf(service.update(admin, "user-1", { email: "Taken@Example.com" }, {})),
			).resolves.toBeInstanceOf(EmailTaken);
			expect(repo.emailExists).toHaveBeenCalledWith("taken@example.com", "user-1");
		});

		it("returns the current user without writing when the patch changes nothing", async () => {
			const result = await run(service.update(member, "user-1", { email: "ada@example.com" }, {}));

			expect(result).toMatchObject({ id: "user-1" });
			expect(repo.update).not.toHaveBeenCalled();
		});
	});

	describe("setBanned", () => {
		it("bans another user", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow()));
			repo.update.mockReturnValue(Effect.succeed(userRow({ banned: true })));

			await run(service.setBanned(admin, "user-1", true));

			expect(repo.update).toHaveBeenCalledWith("user-1", { banned: true });
		});

		it("does not write when the user is already in the requested state", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow({ banned: true })));

			await run(service.setBanned(admin, "user-1", true));

			expect(repo.update).not.toHaveBeenCalled();
		});

		it("ends the target's sessions and keys when banning, and leaves them alone when unbanning", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow()));
			repo.update.mockReturnValue(Effect.succeed(userRow({ banned: true })));

			await run(service.setBanned(admin, "user-1", true));
			expect(repo.revokeCredentials).toHaveBeenCalledWith("user-1");

			repo.revokeCredentials.mockClear();
			repo.findById.mockReturnValue(Effect.succeed(userRow({ banned: true })));
			repo.update.mockReturnValue(Effect.succeed(userRow({ banned: false })));

			await run(service.setBanned(admin, "user-1", false));
			expect(repo.revokeCredentials).not.toHaveBeenCalled();
		});

		it("forbids an admin banning themselves and a user banning anyone", async () => {
			await expect(failureOf(service.setBanned(admin, "admin-1", true))).resolves.toBeInstanceOf(UserForbidden);
			await expect(failureOf(service.setBanned(member, "user-2", true))).resolves.toBeInstanceOf(UserForbidden);
		});

		it("answers not found for an unknown user", async () => {
			repo.findById.mockReturnValue(Effect.succeed(null));

			await expect(failureOf(service.setBanned(admin, "ghost", true))).resolves.toBeInstanceOf(UserNotFound);
		});
	});

	describe("delete", () => {
		it("deletes an existing user", async () => {
			repo.findById.mockReturnValue(Effect.succeed(userRow()));
			repo.delete.mockReturnValue(Effect.void);

			await run(service.delete(admin, "user-1"));

			expect(repo.delete).toHaveBeenCalledWith("user-1");
		});

		it("forbids deleting one's own account and answers not found for an unknown one", async () => {
			await expect(failureOf(service.delete(admin, "admin-1"))).resolves.toBeInstanceOf(UserForbidden);

			repo.findById.mockReturnValue(Effect.succeed(null));
			await expect(failureOf(service.delete(admin, "ghost"))).resolves.toBeInstanceOf(UserNotFound);
			expect(repo.delete).not.toHaveBeenCalled();
		});

		it("forbids a non-administrator", async () => {
			await expect(failureOf(service.delete(member, "user-2"))).resolves.toBeInstanceOf(UserForbidden);
		});
	});

	describe("target-role hierarchy", () => {
		type Role = NonNullable<User["role"]>;

		const actors = {
			superAdmin: root,
			admin,
			operator: { userId: "operator-1", role: "operator" },
			viewer: { userId: "viewer-1", role: "viewer" },
		} as const;

		/** Every action EFF-073 puts behind the hierarchy, plus the write it must make when allowed. */
		const actions = [
			{
				name: "delete",
				call: (actor: Acting, id: string) => service.delete(actor, id),
				written: () => {
					expect(repo.delete).toHaveBeenCalledWith("target-1");
				},
			},
			{
				name: "ban",
				call: (actor: Acting, id: string) => service.setBanned(actor, id, true),
				written: () => {
					expect(repo.update).toHaveBeenCalledWith("target-1", { banned: true });
				},
			},
			{
				name: "email update",
				call: (actor: Acting, id: string) => service.update(actor, id, { email: "next@example.com" }, {}),
				written: () => {
					expect(repo.update).toHaveBeenCalledWith("target-1", { email: "next@example.com" });
				},
			},
		];

		const hierarchy: readonly { actor: keyof typeof actors; target: Role; allowed: boolean }[] = [
			{ actor: "superAdmin", target: "superAdmin", allowed: true },
			{ actor: "superAdmin", target: "admin", allowed: true },
			{ actor: "superAdmin", target: "viewer", allowed: true },
			{ actor: "admin", target: "viewer", allowed: true },
			{ actor: "admin", target: "operator", allowed: true },
			{ actor: "admin", target: "admin", allowed: false },
			{ actor: "admin", target: "superAdmin", allowed: false },
			{ actor: "operator", target: "operator", allowed: false },
			{ actor: "viewer", target: "viewer", allowed: false },
		];

		beforeEach(() => {
			repo.emailExists.mockReturnValue(Effect.succeed(false));
			repo.update.mockImplementation((id: string, patch: object) => Effect.succeed(userRow({ id, ...patch })));
			repo.delete.mockReturnValue(Effect.void);
		});

		describe.each(actions)("$name", ({ call, written }) => {
			it.each(hierarchy)("$actor -> $target (allowed: $allowed)", async ({ actor, target, allowed }) => {
				repo.findById.mockReturnValue(Effect.succeed(userRow({ id: "target-1", role: target })));

				const effect = call(actors[actor], "target-1");

				if (allowed) {
					await run(effect);
					written();
					return;
				}

				await expect(failureOf(effect)).resolves.toBeInstanceOf(UserForbidden);
				expect(repo.update).not.toHaveBeenCalled();
				expect(repo.delete).not.toHaveBeenCalled();
			});
		});
	});

	it("lets a repository failure through unmapped, so the boundary answers it as internal", async () => {
		const cause = new Error("db down");
		repo.findById.mockReturnValue(Effect.fail({ _tag: "UserRepositoryFailure", cause }));

		await expect(failureOf(service.findById(admin, "user-1"))).resolves.toMatchObject({
			_tag: "UserRepositoryFailure",
			cause,
		});
	});

	it("words each refusal for the client, by kind", async () => {
		const forbidden = await failureOf(service.delete(admin, "admin-1"));
		expect(forbidden).toMatchObject({ kind: "forbidden" });
		expect((forbidden as UserForbidden).publicMessage()).toContain("may not delete their own account");

		repo.findById.mockReturnValue(Effect.succeed(null));
		const missing = await failureOf(service.delete(admin, "ghost"));
		expect(missing).toMatchObject({ kind: "not_found", id: "ghost" });
	});
});
