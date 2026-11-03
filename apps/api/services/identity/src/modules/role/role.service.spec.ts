import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actor, CurrentActor } from "@deployer/effect-core";
import { ForbiddenError } from "@deployer/errors";

import { DatabasePort } from "@identity/core/database/database.port";

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
	const list = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		list.mockImplementation(() => Effect.succeed([roleRow()]));
	});

	/** The service over a fake repository, run as one actor. */
	const run = (actor: { userId: string; role: string }, scope?: "platform" | "project") =>
		RoleService.live.list(scope).pipe(
			Effect.provideService(RoleRepository, { list } as unknown as RoleRepositoryShape),
			Effect.provideService(CurrentActor, Actor.user(actor.userId, actor.role)),
			// The port is in the service shape; this spec is about the permission gate, not the query.
			Effect.provideService(DatabasePort, {} as never),
		);

	it("refuses an actor without `role:read`", async () => {
		const outcome = await Effect.runPromise(Effect.flip(run({ userId: "u1", role: "user" })));

		expect(outcome).toBeInstanceOf(ForbiddenError);
		expect(list).not.toHaveBeenCalled();
	});

	it("returns the catalogue for an actor holding `role:read`, scoped when asked", async () => {
		const rows = await Effect.runPromise(run({ userId: "u2", role: "viewer" }, "platform"));

		expect(rows).toEqual([roleRow()]);
		expect(list).toHaveBeenCalledWith("platform");
	});

	it("asks for every scope when none is named", async () => {
		await Effect.runPromise(run({ userId: "u3", role: "superAdmin" }));

		expect(list).toHaveBeenCalledWith(undefined);
	});
});

