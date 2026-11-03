import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actor, CurrentActor } from "@deployer/effect-core";
import { ForbiddenError } from "@deployer/errors";

import { DatabasePort } from "@identity/core/database/database.port";

import { AuditRepository, type AuditPage, type AuditRepositoryShape, type AuditRow } from "./audit.repository";
import { AuditService, auditRowsToCsv } from "./audit.service";

const row = (overrides: Partial<AuditRow> = {}): AuditRow => ({
	id: 7,
	action: "role-change",
	actorId: "admin-1",
	targetId: "user-1",
	ip: "10.0.0.1",
	userAgent: "vitest, with a comma",
	detail: { role: "admin" },
	createdAt: new Date("2026-11-03T10:00:00.000Z"),
	...overrides,
});

const page = (rows: AuditRow[], hasMore = false): AuditPage => ({ data: rows, meta: { limit: 50, hasMore } });

describe("AuditService", () => {
	const list = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		list.mockImplementation(() => Effect.succeed(page([row()])));
	});

	/** The service over a fake repository, run as one actor. */
	const run = <A, E>(
		actor: { userId: string; role: string },
		use: (audit: AuditService["Service"]) => Effect.Effect<
			A,
			E,
			AuditRepository | CurrentActor | DatabasePort
		>,
	): Effect.Effect<A, E> =>
		Effect.gen(function* () {
			const audit = yield* AuditService;
			return yield* use(audit);
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					Layer.succeed(AuditService, AuditService.live as unknown as AuditService["Service"]),
					Layer.succeed(AuditRepository, { list, append: () => Effect.void } as unknown as AuditRepositoryShape),
					Layer.succeed(CurrentActor, Actor.user(actor.userId, actor.role)),
					Layer.succeed(DatabasePort, {} as never),
				),
			),
		);

	it("lets a reader list the log", async () => {
		const result = await Effect.runPromise(
			run({ userId: "v1", role: "viewer" }, (audit) => audit.list({ limit: 50 })),
		);

		expect(result.data).toHaveLength(1);
	});

	it("refuses the export to a reader: exporting is its own capability", async () => {
		const outcome = await Effect.runPromise(
			Effect.flip(run({ userId: "v1", role: "viewer" }, (audit) => audit.export({ limit: 1000 }))),
		);

		expect(outcome).toBeInstanceOf(ForbiddenError);
		expect(list).not.toHaveBeenCalled();
	});

	it("exports the rows an admin asked for, and says when the cap cut them", async () => {
		list.mockImplementation(() => Effect.succeed(page([row(), row({ id: 6 })], true)));

		const result = await Effect.runPromise(
			run({ userId: "a1", role: "admin" }, (audit) => audit.export({ limit: 2, action: "role-change" })),
		);

		expect(result).toMatchObject({ rows: 2, truncated: true });
		expect(result.csv.split("\n")[0]).toBe("id,createdAt,action,actorId,targetId,ip,userAgent,detail");
		expect(list).toHaveBeenCalledWith({ limit: 2, action: "role-change" });
	});

	it("quotes a field that carries a separator", () => {
		const csv = auditRowsToCsv([row()]);

		expect(csv).toContain('"vitest, with a comma"');
		// The detail is JSON, so its quotes are doubled rather than ending the cell.
		expect(csv).toContain('"{""role"":""admin""}"');
	});
});
