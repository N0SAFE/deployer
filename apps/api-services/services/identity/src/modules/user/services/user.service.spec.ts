import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@deployer/errors";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabasePort, type DatabaseShape } from "@identity/core/database/database.port";
import type { User } from "../domain/user.types";
import { UserRepository, type UserRepositoryShape } from "../repositories/user.repository";
import type { UserServiceFailure } from "../user.failures";
import { UserServiceImpl } from "./user.service";

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
	};
	for (const fn of Object.values(repo)) fn.mockImplementation(() => Effect.succeed(undefined));
	return repo;
}

describe("UserServiceImpl", () => {
	const database = {} as DatabaseShape;
	const service = new UserServiceImpl();
	let repo: ReturnType<typeof makeRepository>;

	beforeEach(() => {
		repo = makeRepository();
	});

	/** Run a use case against the fake repository. */
	const run = <A, E>(effect: Effect.Effect<A, E, UserRepository | DatabasePort>) =>
		Effect.runPromise(
			effect.pipe(
				Effect.provideService(UserRepository, repo as unknown as UserRepositoryShape),
				Effect.provideService(DatabasePort, database),
			),
		);

	/** The domain error a use case failed with. */
	const failureOf = (effect: Effect.Effect<unknown, UserServiceFailure, UserRepository | DatabasePort>) =>
		run(Effect.flip(effect)).then((failure) => failure.cause);

	describe("list / count", () => {
		it("forbids an ordinary user", async () => {
			const query = { limit: 10, offset: 0, sortField: "createdAt", sortDirection: "desc", filter: {} } as const;

			await expect(failureOf(service.list(member, query))).resolves.toBeInstanceOf(ForbiddenError);
			await expect(failureOf(service.count(member, {}))).resolves.toBeInstanceOf(ForbiddenError);
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
			await expect(failureOf(service.findById(member, "user-2"))).resolves.toBeInstanceOf(ForbiddenError);
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

			await expect(run(service.checkEmail("  Ada@Example.COM "))).resolves.toBe(true);
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
				ForbiddenError,
			);
		});

		it("forbids an admin granting superAdmin, but lets a superAdmin", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(false));
			repo.insert.mockImplementation((input: unknown) => Effect.succeed(input));
			const input = { name: "Root", email: "r@b.co", role: "superAdmin" } as const;

			await expect(failureOf(service.create(admin, input))).resolves.toBeInstanceOf(ForbiddenError);
			await expect(run(service.create(root, input))).resolves.toMatchObject({ role: "superAdmin" });
		});

		it("rejects an unusable email or a blank name before the database", async () => {
			await expect(failureOf(service.create(admin, { name: "A", email: "nope" }))).resolves.toBeInstanceOf(
				ValidationError,
			);
			await expect(failureOf(service.create(admin, { name: " ", email: "a@b.co" }))).resolves.toBeInstanceOf(
				ValidationError,
			);
			expect(repo.emailExists).not.toHaveBeenCalled();
		});

		it("conflicts when the email is taken", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(true));

			await expect(failureOf(service.create(admin, { name: "A", email: "a@b.co" }))).resolves.toBeInstanceOf(
				ConflictError,
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
			).resolves.toBeInstanceOf(ValidationError);
			expect(repo.findById).not.toHaveBeenCalled();
		});

		it("answers not found for an unknown user", async () => {
			repo.findById.mockReturnValue(Effect.succeed(null));

			await expect(failureOf(service.update(admin, "ghost", { name: "X" }, {}))).resolves.toBeInstanceOf(
				NotFoundError,
			);
		});

		it("forbids changing someone else's account without administration", async () => {
			await expect(failureOf(service.update(member, "user-2", { name: "X" }, {}))).resolves.toBeInstanceOf(
				ForbiddenError,
			);
		});

		it("narrows a self-update to name and email, ignoring fields a user may not change", async () => {
			// `role` equal to the current one is not a change, so it is dropped rather than refused.
			await run(service.update(member, "user-1", { name: " Ada L. ", role: "viewer", banned: true }, {}));

			expect(repo.update).toHaveBeenCalledWith("user-1", { name: "Ada L." });
		});

		it("refuses a user who asks to change their own role", async () => {
			await expect(failureOf(service.update(member, "user-1", { role: "admin" }, {}))).resolves.toBeInstanceOf(
				ForbiddenError,
			);
			expect(repo.update).not.toHaveBeenCalled();
		});

		it("lets an admin change a role, but not to superAdmin", async () => {
			await run(service.update(admin, "user-1", { role: "admin" }, {}));
			expect(repo.update).toHaveBeenCalledWith("user-1", { role: "admin" });

			await expect(
				failureOf(service.update(admin, "user-1", { role: "superAdmin" }, {})),
			).resolves.toBeInstanceOf(ForbiddenError);
		});

		it("conflicts on an email another account holds, checking it excluding this user", async () => {
			repo.emailExists.mockReturnValue(Effect.succeed(true));

			await expect(
				failureOf(service.update(admin, "user-1", { email: "Taken@Example.com" }, {})),
			).resolves.toBeInstanceOf(ConflictError);
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

		it("forbids an admin banning themselves and a user banning anyone", async () => {
			await expect(failureOf(service.setBanned(admin, "admin-1", true))).resolves.toBeInstanceOf(ForbiddenError);
			await expect(failureOf(service.setBanned(member, "user-2", true))).resolves.toBeInstanceOf(ForbiddenError);
		});

		it("answers not found for an unknown user", async () => {
			repo.findById.mockReturnValue(Effect.succeed(null));

			await expect(failureOf(service.setBanned(admin, "ghost", true))).resolves.toBeInstanceOf(NotFoundError);
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
			await expect(failureOf(service.delete(admin, "admin-1"))).resolves.toBeInstanceOf(ForbiddenError);

			repo.findById.mockReturnValue(Effect.succeed(null));
			await expect(failureOf(service.delete(admin, "ghost"))).resolves.toBeInstanceOf(NotFoundError);
			expect(repo.delete).not.toHaveBeenCalled();
		});

		it("forbids a non-administrator", async () => {
			await expect(failureOf(service.delete(member, "user-2"))).resolves.toBeInstanceOf(ForbiddenError);
		});
	});

	it("collapses a repository failure into the service failure, keeping the cause", async () => {
		const cause = new Error("db down");
		repo.findById.mockReturnValue(Effect.fail({ _tag: "UserRepositoryFailure", cause }));

		await expect(failureOf(service.findById(admin, "user-1"))).resolves.toBe(cause);
	});
});
