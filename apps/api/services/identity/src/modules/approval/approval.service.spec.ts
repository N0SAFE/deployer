import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Actor, Correlation, CurrentActor } from "@deployer/effect-core";
import { ForbiddenError } from "@deployer/errors";

import { DatabasePort } from "@identity/core/database/database.port";
import { AuditService } from "@identity/modules/audit/audit.service";
import { StepUpService } from "@identity/modules/step-up/step-up.service";

import { ApprovalForbidden, ApprovalInvalid } from "./approval.errors";
import { ApprovalRepository, type AccessRequestRow, type ApprovalRepositoryShape } from "./approval.repository";
import { ApprovalService } from "./approval.service";

const request = (overrides: Partial<AccessRequestRow> = {}): AccessRequestRow => ({
	id: "req-1",
	permission: "deployment:create",
	requesterId: "requester",
	via: null,
	scope: { projectId: "p-1" },
	actionHash: "a".repeat(64),
	reason: "prod hotfix",
	requiredApprovals: 1,
	status: "pending",
	ttlSec: 3600,
	expiresAt: new Date(Date.now() + 3_600_000),
	consumedAt: null,
	createdAt: new Date(),
	approvals: 0,
	...overrides,
});

describe("ApprovalService", () => {
	const repo = {
		create: vi.fn(),
		findById: vi.fn(),
		list: vi.fn(),
		vote: vi.fn(),
		consume: vi.fn(),
	};

	beforeEach(() => {
		vi.clearAllMocks();
		repo.create.mockImplementation(() => Effect.succeed(request()));
		repo.findById.mockImplementation(() => Effect.succeed(request()));
		repo.vote.mockImplementation(() => Effect.succeed(request({ status: "approved", approvals: 1 })));
		repo.consume.mockImplementation(() => Effect.succeed(true));
	});

	const run = <A, E>(
		actor: Actor,
		use: (approvals: ApprovalService["Service"]) => Effect.Effect<
			A,
			E,
			ApprovalRepository | CurrentActor | DatabasePort | StepUpService | AuditService
		>,
		stepUp: "ok" | "missing" = "ok",
	): Effect.Effect<A, E> => {
		const layer = Layer.mergeAll(
			Layer.succeed(ApprovalService, ApprovalService.live),
			Layer.succeed(ApprovalRepository, repo as unknown as ApprovalRepositoryShape),
			Layer.succeed(CurrentActor, actor),
			Layer.succeed(Correlation, { id: "test" }),
			Layer.succeed(DatabasePort, {} as never),
			Layer.succeed(AuditService, { record: () => Effect.void } as unknown as AuditService["Service"]),
			Layer.succeed(StepUpService, {
				assertCritical: () =>
					stepUp === "ok" ? Effect.void : Effect.fail(new ForbiddenError("step-up required")),
				status: () => Effect.die(new Error("unused")),
			} as unknown as StepUpService["Service"]),
		);

		return Effect.gen(function* () {
			const approvals = yield* ApprovalService;
			return yield* use(approvals);
		}).pipe(Effect.provide(layer));
	};

	const input = {
		permission: "deployment:create",
		scope: { projectId: "p-1" },
		actionHash: "a".repeat(64),
		reason: "prod hotfix",
		ttlSec: 3600,
		requiredApprovals: 1,
	};

	it("refuses a permission the catalog does not declare", async () => {
		const outcome = await Effect.runPromise(
			Effect.flip(run(Actor.user("requester", "user"), (a) => a.request({ ...input, permission: "deploy:everything" }))),
		);

		expect(outcome).toBeInstanceOf(ApprovalInvalid);
		expect(repo.create).not.toHaveBeenCalled();
	});

	it("records the requester and the expiry it was asked for", async () => {
		await Effect.runPromise(run(Actor.user("requester", "operator"), (a) => a.request(input)));

		const created = repo.create.mock.calls[0]?.[0] as { requesterId: string; expiresAt: Date; ttlSec: number };
		expect(created.requesterId).toBe("requester");
		expect(created.ttlSec).toBe(3600);
		expect(created.expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	it("refuses a system caller: a request belongs to a person", async () => {
		const outcome = await Effect.runPromise(Effect.flip(run(Actor.system("scheduler"), (a) => a.request(input))));

		expect(outcome).toBeInstanceOf(ApprovalForbidden);
	});

	it("refuses to decide your own request", async () => {
		const outcome = await Effect.runPromise(
			Effect.flip(run(Actor.user("requester", "superAdmin"), (a) => a.decide("req-1", "approve"))),
		);

		expect(outcome).toBeInstanceOf(ApprovalForbidden);
		expect(repo.vote).not.toHaveBeenCalled();
	});

	it("refuses to decide without a fresh passkey proof", async () => {
		const outcome = await Effect.runPromise(
			Effect.flip(run(Actor.user("approver", "superAdmin"), (a) => a.decide("req-1", "approve"), "missing")),
		);

		expect(outcome).toBeInstanceOf(ApprovalForbidden);
		expect(repo.vote).not.toHaveBeenCalled();
	});

	it("refuses a request that is no longer pending", async () => {
		repo.findById.mockImplementation(() => Effect.succeed(request({ status: "denied" })));

		const outcome = await Effect.runPromise(
			Effect.flip(run(Actor.user("approver", "superAdmin"), (a) => a.decide("req-1", "approve"))),
		);

		expect(outcome).toBeInstanceOf(ApprovalInvalid);
	});

	it("refuses an expired request", async () => {
		repo.findById.mockImplementation(() => Effect.succeed(request({ expiresAt: new Date(Date.now() - 1000) })));

		const outcome = await Effect.runPromise(
			Effect.flip(run(Actor.user("approver", "superAdmin"), (a) => a.decide("req-1", "approve"))),
		);

		expect(outcome).toBeInstanceOf(ApprovalInvalid);
	});

	it("records a vote from another approver", async () => {
		const decided = await Effect.runPromise(
			run(Actor.user("approver", "superAdmin"), (a) => a.decide("req-1", "approve")),
		);

		expect(decided.status).toBe("approved");
		expect(repo.vote).toHaveBeenCalledWith("req-1", "approver", "approve");
	});

	it("lists only for an actor holding `approval:read`", async () => {
		repo.list.mockImplementation(() => Effect.succeed([request()]));

		const rows = await Effect.runPromise(
			run(Actor.user("viewer-1", "viewer"), (a) => a.list({ status: "pending", limit: 50 })),
		);
		expect(rows).toHaveLength(1);

		const denied = await Effect.runPromise(
			Effect.flip(run(Actor.user("u-1", "user"), (a) => a.list({ status: "pending", limit: 50 }))),
		);
		expect(denied).toBeInstanceOf(ApprovalForbidden);
	});

	it("spends the approval of the requester", async () => {
		const result = await Effect.runPromise(run(Actor.user("requester", "user"), (a) => a.consume("a".repeat(64))));

		expect(result).toEqual({ consumed: true });
		expect(repo.consume).toHaveBeenCalledWith("requester", "a".repeat(64), expect.any(Date));
	});
});
