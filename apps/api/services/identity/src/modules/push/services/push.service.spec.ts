import { NotFoundError, ValidationError } from "@deployer/errors";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DatabasePort } from "@identity/core/database/database.port";

import { PushRepository, type PushRepositoryShape } from "../repositories/push.repository";
import type { StoredSubscription, VapidKeys } from "../repositories/push.repository.types";
import { PushServiceFailure } from "../push.failures";
import { PushServiceImpl, type Actor } from "./push.service";

/**
 * The push domain's RULES.
 *
 * The repository is faked with plain Effects, which is the point: these tests are
 * about policy — which endpoints are refused, who may unsubscribe what, and what
 * the statistics mean — not about SQL. If any of them needed a database, the
 * layering would be wrong.
 */
const owner: Actor = { userId: "user-owner", role: "user" };
const other: Actor = { userId: "user-other", role: "user" };

/** A valid HTTPS endpoint, as a browser would produce. */
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

/** Base64url key material of a plausible length, since that is what is validated. */
const P256DH = "B".repeat(80);
const AUTH = "a".repeat(20);

const service = new PushServiceImpl();

/** A stored row; only the fields a test cares about are overridden. */
function subscription(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
	return {
		id: "sub-1",
		userId: owner.userId,
		endpoint: ENDPOINT,
		p256dh: P256DH,
		auth: AUTH,
		deviceName: "Phone",
		userAgent: null,
		isActive: true,
		createdAt: new Date("2026-10-01T00:00:00Z"),
		updatedAt: new Date("2026-10-01T00:00:00Z"),
		lastUsedAt: null,
		...overrides,
	};
}

/** A fake repository whose methods are Effects — no database involved. */
function fakeRepository() {
	return {
		findByEndpoint: vi.fn((_endpoint: string) => Effect.succeed<StoredSubscription | null>(null)),
		listByUser: vi.fn((_userId: string, _onlyActive: boolean) => Effect.succeed<StoredSubscription[]>([])),
		countByUser: vi.fn((_userId: string, _onlyActive: boolean) => Effect.succeed(0)),
		countDeliverable: vi.fn(() => Effect.succeed(0)),
		upsert: vi.fn((_input: unknown) => Effect.succeed(subscription())),
		deleteByEndpointForUser: vi.fn((_userId: string, _endpoint: string) => Effect.succeed(true)),
		markUsed: vi.fn((_id: string) => Effect.succeed(undefined)),
		deactivate: vi.fn((_id: string) => Effect.succeed(undefined)),
		findVapidKeys: vi.fn((_userId: string) => Effect.succeed<VapidKeys | null>(null)),
		insertVapidKeys: vi.fn((keys: VapidKeys) =>
			Effect.succeed({ ...keys, publicKey: "public-key", privateKey: "private-key" }),
		),
	} satisfies PushRepositoryShape;
}

/** Run a service Effect with the fake repository and an unused database. */
function run<A, E>(
	effect: Effect.Effect<A, E, PushRepository | DatabasePort>,
	repository: PushRepositoryShape,
): Promise<A> {
	return Effect.runPromise(
		effect.pipe(
			Effect.provideService(PushRepository, repository),
			Effect.provideService(DatabasePort, { db: {} as never }),
		),
	);
}

/** Run a service Effect that MUST fail, resolving with its typed failure. */
function runFailing<E>(
	effect: Effect.Effect<unknown, E, PushRepository | DatabasePort>,
	repository: PushRepositoryShape,
): Promise<PushServiceFailure> {
	return Effect.runPromise(
		Effect.flip(effect).pipe(
			Effect.map((error) => error as PushServiceFailure),
			Effect.provideService(PushRepository, repository),
			Effect.provideService(DatabasePort, { db: {} as never }),
		),
	);
}

describe("PushService", () => {
	let repository: ReturnType<typeof fakeRepository>;

	beforeEach(() => {
		repository = fakeRepository();
	});

	describe("subscribe", () => {
		it("stores the subscription under the CALLER, not a supplied user id", async () => {
			await run(
				service.subscribe(owner, {
					endpoint: ENDPOINT,
					keys: { p256dh: P256DH, auth: AUTH },
					deviceName: "Phone",
				}),
				repository,
			);

			// The actor is the only source of the owner. Accepting a userId from the request
			// would let a caller register a device on somebody else's account and receive
			// their notifications.
			expect(repository.upsert).toHaveBeenCalledWith(
				expect.objectContaining({ userId: owner.userId, endpoint: ENDPOINT }),
			);
		});

		it("ensures a VAPID keypair BEFORE storing the subscription", async () => {
			await run(
				service.subscribe(owner, { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }),
				repository,
			);

			// A subscription with no keypair looks live and silently cannot be delivered to,
			// so the keypair is generated first. Ordering is asserted by call sequence.
			expect(repository.insertVapidKeys).toHaveBeenCalled();
			const vapidCall = repository.insertVapidKeys.mock.invocationCallOrder[0] ?? 0;
			const upsertCall = repository.upsert.mock.invocationCallOrder[0] ?? 0;
			expect(vapidCall).toBeLessThan(upsertCall);
		});

		it("reuses an existing keypair rather than minting a second one", async () => {
			repository.findVapidKeys.mockReturnValueOnce(
				Effect.succeed({
					userId: owner.userId,
					publicKey: "existing",
					privateKey: "existing-private",
					subject: "s",
				}),
			);

			await run(
				service.subscribe(owner, { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } }),
				repository,
			);

			// A second keypair would make every notification signed with the first
			// undecryptable, so the existing one must win.
			expect(repository.insertVapidKeys).not.toHaveBeenCalled();
		});

		it("refuses a non-HTTPS endpoint", async () => {
			// The server POSTs to this URL, so an unchecked value is an SSRF primitive —
			// the request could be aimed at an internal address.
			const error = await runFailing(
				service.subscribe(owner, {
					endpoint: "http://169.254.169.254/latest/meta-data",
					keys: { p256dh: P256DH, auth: AUTH },
				}),
				repository,
			);

			expect(error.cause).toBeInstanceOf(ValidationError);
			expect(repository.upsert).not.toHaveBeenCalled();
		});

		it("refuses a truncated p256dh key", async () => {
			// A malformed key does not fail here — it fails days later as an opaque 400 from
			// the push service, by which point the cause is unrecoverable.
			const error = await runFailing(
				service.subscribe(owner, { endpoint: ENDPOINT, keys: { p256dh: "short", auth: AUTH } }),
				repository,
			);

			expect(error.cause).toBeInstanceOf(ValidationError);
		});

		it("refuses a non-base64url auth key", async () => {
			const error = await runFailing(
				service.subscribe(owner, {
					endpoint: ENDPOINT,
					keys: { p256dh: P256DH, auth: "not valid base64!!! with spaces" },
				}),
				repository,
			);

			expect(error.cause).toBeInstanceOf(ValidationError);
		});

		it("does not persist anything when validation fails", async () => {
			await runFailing(
				service.subscribe(owner, { endpoint: "ftp://x", keys: { p256dh: P256DH, auth: AUTH } }),
				repository,
			);

			expect(repository.upsert).not.toHaveBeenCalled();
			expect(repository.insertVapidKeys).not.toHaveBeenCalled();
		});
	});

	describe("unsubscribe", () => {
		it("removes the caller's own subscription", async () => {
			repository.findByEndpoint.mockReturnValueOnce(Effect.succeed(subscription()));

			await expect(run(service.unsubscribe(owner, ENDPOINT), repository)).resolves.toEqual({
				success: true,
			});
			expect(repository.deleteByEndpointForUser).toHaveBeenCalledWith(owner.userId, ENDPOINT);
		});

		it("refuses to remove another user's subscription", async () => {
			repository.findByEndpoint.mockReturnValueOnce(
				Effect.succeed(subscription({ userId: other.userId })),
			);

			const error = await runFailing(service.unsubscribe(owner, ENDPOINT), repository);

			expect(error.cause).toBeInstanceOf(NotFoundError);
			expect(repository.deleteByEndpointForUser).not.toHaveBeenCalled();
		});

		it("reports a NOT FOUND for an unknown endpoint rather than a false success", async () => {
			// The contract declares an error for an unknown endpoint; a success-shaped body
			// with `false` inside would make a typo indistinguishable from a real removal.
			const error = await runFailing(service.unsubscribe(owner, ENDPOINT), repository);

			expect(error.cause).toBeInstanceOf(NotFoundError);
		});

		it("does not distinguish 'not yours' from 'not found'", async () => {
			// Distinguishing them would confirm that an endpoint belongs to somebody else,
			// which is information the caller has no reason to have.
			repository.findByEndpoint.mockReturnValueOnce(
				Effect.succeed(subscription({ userId: other.userId })),
			);
			const notYours = await runFailing(service.unsubscribe(owner, ENDPOINT), repository);

			const empty = fakeRepository();
			const notFound = await runFailing(service.unsubscribe(owner, ENDPOINT), empty);

			expect((notYours.cause as Error).message).toBe((notFound.cause as Error).message);
		});

		it("scopes the DELETE to the actor, so a re-owned endpoint cannot be removed by the previous holder", async () => {
			// Checking ownership in one statement and deleting in another leaves a window; the
			// delete therefore carries the userId as well, making check and write one predicate.
			repository.findByEndpoint.mockReturnValueOnce(Effect.succeed(subscription()));

			await run(service.unsubscribe(owner, ENDPOINT), repository);

			expect(repository.deleteByEndpointForUser).toHaveBeenCalledWith(owner.userId, ENDPOINT);
		});
	});

	describe("stats", () => {
		it("asks the database for each figure separately", async () => {
			repository.countByUser.mockImplementation((_userId, onlyActive) =>
				Effect.succeed(onlyActive ? 2 : 3),
			);

			const stats = await run(service.stats(owner), repository);

			// `total` counts every row while `devices` lists only active ones, so deriving the
			// total from the list would report a number that disagrees with the table.
			expect(repository.countByUser).toHaveBeenCalledWith(owner.userId, false);
			expect(repository.countByUser).toHaveBeenCalledWith(owner.userId, true);
			expect(stats).toMatchObject({ totalSubscriptions: 3, activeSubscriptions: 2 });
		});

		it("falls back to the registration time for a device never used", async () => {
			const createdAt = new Date("2026-09-01T10:00:00Z");
			repository.listByUser.mockReturnValueOnce(
				Effect.succeed([subscription({ deviceName: null, lastUsedAt: null, createdAt })]),
			);

			const stats = await run(service.stats(owner), repository);

			// `createdAt` and NOT `now()`: "never used" genuinely means "not used since
			// registration", and substituting the current time would make an unused device look
			// like the most recently active one.
			expect(stats.devices[0]).toEqual({ deviceName: "Unknown Device", lastUsed: createdAt });
		});

		it("defaults an unnamed device rather than rendering an empty label", async () => {
			repository.listByUser.mockReturnValueOnce(
				Effect.succeed([subscription({ deviceName: null })]),
			);

			const stats = await run(service.stats(owner), repository);
			expect(stats.devices[0]?.deviceName).toBe("Unknown Device");
		});
	});

	describe("publicKey", () => {
		it("generates and stores a keypair on first use", async () => {
			await run(service.publicKey(owner), repository);
			expect(repository.insertVapidKeys).toHaveBeenCalledTimes(1);
		});

		it("returns the existing public key without minting another", async () => {
			repository.findVapidKeys.mockReturnValueOnce(
				Effect.succeed({
					userId: owner.userId,
					publicKey: "existing-public",
					privateKey: "p",
					subject: "s",
				}),
			);

			await expect(run(service.publicKey(owner), repository)).resolves.toEqual({
				publicKey: "existing-public",
			});
			expect(repository.insertVapidKeys).not.toHaveBeenCalled();
		});
	});

	describe("recordDelivery", () => {
		it("records a successful delivery as usage", async () => {
			await run(service.recordDelivery("sub-1", { delivered: true, gone: false }), repository);

			expect(repository.markUsed).toHaveBeenCalledWith("sub-1");
			expect(repository.deactivate).not.toHaveBeenCalled();
		});

		it("retires an endpoint the push service rejected", async () => {
			// A 404/410 endpoint will never work again, so retrying it forever wastes every
			// future send. Marking it inactive keeps the row (a re-subscribe can re-activate it)
			// while removing it from the delivery set.
			await run(service.recordDelivery("sub-1", { delivered: false, gone: true }), repository);

			expect(repository.deactivate).toHaveBeenCalledWith("sub-1");
			expect(repository.markUsed).not.toHaveBeenCalled();
		});

		it("does nothing for a transient failure", async () => {
			// A 500 or a timeout is worth retrying, so neither the usage stamp nor the
			// retirement should happen.
			await run(service.recordDelivery("sub-1", { delivered: false, gone: false }), repository);

			expect(repository.markUsed).not.toHaveBeenCalled();
			expect(repository.deactivate).not.toHaveBeenCalled();
		});
	});

	describe("deliverableCount", () => {
		it("delegates to the CROSS-TABLE count, which excludes banned owners", async () => {
			// Activity is necessary and not sufficient: a ban does not flip the device rows, so
			// the count of `is_active = true` rows alone would include accounts that must not be
			// notified.
			repository.countDeliverable.mockReturnValueOnce(Effect.succeed(7));

			await expect(run(service.deliverableCount(), repository)).resolves.toBe(7);
			expect(repository.countDeliverable).toHaveBeenCalled();
		});
	});

	describe("list", () => {
		it("maps a repository failure into PushServiceFailure", async () => {
			repository.listByUser.mockReturnValueOnce(
				Effect.fail({ _tag: "PushRepositoryFailure", cause: new Error("db down") }) as never,
			);

			const error = await runFailing(service.list(owner), repository);

			expect(error).toMatchObject({ _tag: "PushServiceFailure" });
			expect((error as { cause: unknown }).cause).toBeInstanceOf(Error);
		});
	});
});
