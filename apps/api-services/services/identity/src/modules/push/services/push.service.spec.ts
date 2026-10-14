import { NotFoundError, ValidationError } from "@deployer/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PushRepository } from "../repositories/push.repository";
import { PushService, type Actor } from "./push.service";

/**
 * The push domain's RULES.
 *
 * The repository is stubbed, which is the point: these tests are about policy — which
 * endpoints are refused, who may unsubscribe what, and what the statistics mean — not
 * about SQL. If any of them needed a database, the layering would be wrong.
 */
const owner: Actor = { userId: "user-owner", role: "user" };
const other: Actor = { userId: "user-other", role: "user" };

/** A valid HTTPS endpoint, as a browser would produce. */
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123";

/** Base64url key material of a plausible length, since that is what is validated. */
const P256DH = "B".repeat(80);
const AUTH = "a".repeat(20);

describe("PushService", () => {
	let service: PushService;
	let repository: {
		findByEndpoint: ReturnType<typeof vi.fn>;
		listByUser: ReturnType<typeof vi.fn>;
		countByUser: ReturnType<typeof vi.fn>;
		countDeliverable: ReturnType<typeof vi.fn>;
		upsert: ReturnType<typeof vi.fn>;
		deleteByEndpointForUser: ReturnType<typeof vi.fn>;
		markUsed: ReturnType<typeof vi.fn>;
		deactivate: ReturnType<typeof vi.fn>;
		findVapidKeys: ReturnType<typeof vi.fn>;
		insertVapidKeys: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		repository = {
			findByEndpoint: vi.fn(async () => null),
			listByUser: vi.fn(async () => []),
			countByUser: vi.fn(async () => 0),
			countDeliverable: vi.fn(async () => 0),
			upsert: vi.fn(async () => ({
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
			})),
			deleteByEndpointForUser: vi.fn(async () => true),
			markUsed: vi.fn(async () => undefined),
			deactivate: vi.fn(async () => undefined),
			findVapidKeys: vi.fn(async () => null),
			insertVapidKeys: vi.fn(async (keys: { userId: string }) => ({
				userId: keys.userId,
				publicKey: "public-key",
				privateKey: "private-key",
				subject: "mailto:test@notifications.local",
			})),
		};

		service = new PushService(repository as unknown as PushRepository);
	});

	describe("subscribe", () => {
		it("stores the subscription under the CALLER, not a supplied user id", async () => {
			await service.subscribe(owner, {
				endpoint: ENDPOINT,
				keys: { p256dh: P256DH, auth: AUTH },
				deviceName: "Phone",
			});

			// The actor is the only source of the owner. Accepting a userId from the request
			// would let a caller register a device on somebody else's account and receive
			// their notifications.
			expect(repository.upsert).toHaveBeenCalledWith(
				expect.objectContaining({ userId: owner.userId, endpoint: ENDPOINT }),
			);
		});

		it("ensures a VAPID keypair BEFORE storing the subscription", async () => {
			await service.subscribe(owner, { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } });

			// A subscription with no keypair looks live and silently cannot be delivered to,
			// so the keypair is generated first. Ordering is asserted by call sequence.
			expect(repository.insertVapidKeys).toHaveBeenCalled();
			const vapidCall = repository.insertVapidKeys.mock.invocationCallOrder[0]!;
			const upsertCall = repository.upsert.mock.invocationCallOrder[0]!;
			expect(vapidCall).toBeLessThan(upsertCall);
		});

		it("reuses an existing keypair rather than minting a second one", async () => {
			repository.findVapidKeys.mockResolvedValueOnce({
				userId: owner.userId,
				publicKey: "existing",
				privateKey: "existing-private",
				subject: "s",
			});

			await service.subscribe(owner, { endpoint: ENDPOINT, keys: { p256dh: P256DH, auth: AUTH } });

			// A second keypair would make every notification signed with the first
			// undecryptable, so the existing one must win.
			expect(repository.insertVapidKeys).not.toHaveBeenCalled();
		});

		it("refuses a non-HTTPS endpoint", async () => {
			// The server POSTs to this URL, so an unchecked value is an SSRF primitive —
			// the request could be aimed at an internal address.
			await expect(
				service.subscribe(owner, {
					endpoint: "http://169.254.169.254/latest/meta-data",
					keys: { p256dh: P256DH, auth: AUTH },
				}),
			).rejects.toThrow(ValidationError);

			expect(repository.upsert).not.toHaveBeenCalled();
		});

		it("refuses a truncated p256dh key", async () => {
			// A malformed key does not fail here — it fails days later as an opaque 400 from
			// the push service, by which point the cause is unrecoverable.
			await expect(
				service.subscribe(owner, { endpoint: ENDPOINT, keys: { p256dh: "short", auth: AUTH } }),
			).rejects.toThrow(ValidationError);
		});

		it("refuses a non-base64url auth key", async () => {
			await expect(
				service.subscribe(owner, {
					endpoint: ENDPOINT,
					keys: { p256dh: P256DH, auth: "not valid base64!!! with spaces" },
				}),
			).rejects.toThrow(ValidationError);
		});

		it("does not persist anything when validation fails", async () => {
			await expect(
				service.subscribe(owner, { endpoint: "ftp://x", keys: { p256dh: P256DH, auth: AUTH } }),
			).rejects.toThrow();

			expect(repository.upsert).not.toHaveBeenCalled();
			expect(repository.insertVapidKeys).not.toHaveBeenCalled();
		});
	});

	describe("unsubscribe", () => {
		it("removes the caller's own subscription", async () => {
			repository.findByEndpoint.mockResolvedValueOnce({
				id: "sub-1",
				userId: owner.userId,
				endpoint: ENDPOINT,
			});

			await expect(service.unsubscribe(owner, ENDPOINT)).resolves.toEqual({ success: true });
			expect(repository.deleteByEndpointForUser).toHaveBeenCalledWith(owner.userId, ENDPOINT);
		});

		it("refuses to remove another user's subscription", async () => {
			repository.findByEndpoint.mockResolvedValueOnce({
				id: "sub-1",
				userId: other.userId,
				endpoint: ENDPOINT,
			});

			await expect(service.unsubscribe(owner, ENDPOINT)).rejects.toThrow(NotFoundError);
			expect(repository.deleteByEndpointForUser).not.toHaveBeenCalled();
		});

		it("reports a NOT FOUND for an unknown endpoint rather than a false success", async () => {
			// The contract declares an error for an unknown endpoint; a success-shaped body
			// with `false` inside would make a typo indistinguishable from a real removal.
			await expect(service.unsubscribe(owner, ENDPOINT)).rejects.toThrow(NotFoundError);
		});

		it("does not distinguish 'not yours' from 'not found'", async () => {
			// Distinguishing them would confirm that an endpoint belongs to somebody else,
			// which is information the caller has no reason to have.
			repository.findByEndpoint.mockResolvedValueOnce({
				id: "sub-1",
				userId: other.userId,
				endpoint: ENDPOINT,
			});
			const notYours = await service.unsubscribe(owner, ENDPOINT).catch((e: unknown) => e);

			repository.findByEndpoint.mockResolvedValueOnce(null);
			const notFound = await service.unsubscribe(owner, ENDPOINT).catch((e: unknown) => e);

			expect((notYours as Error).message).toBe((notFound as Error).message);
		});

		it("scopes the DELETE to the actor, so a re-owned endpoint cannot be removed by the previous holder", async () => {
			// Checking ownership in one statement and deleting in another leaves a window; the
			// delete therefore carries the userId as well, making check and write one predicate.
			repository.findByEndpoint.mockResolvedValueOnce({
				id: "sub-1",
				userId: owner.userId,
				endpoint: ENDPOINT,
			});
			await service.unsubscribe(owner, ENDPOINT);

			expect(repository.deleteByEndpointForUser).toHaveBeenCalledWith(owner.userId, ENDPOINT);
		});
	});

	describe("stats", () => {
		it("asks the database for each figure separately", async () => {
			repository.countByUser.mockImplementation(async (_u: string, onlyActive: boolean) =>
				onlyActive ? 2 : 3,
			);

			const stats = await service.stats(owner);

			// `total` counts every row while `devices` lists only active ones, so deriving the
			// total from the list would report a number that disagrees with the table.
			expect(repository.countByUser).toHaveBeenCalledWith(owner.userId, false);
			expect(repository.countByUser).toHaveBeenCalledWith(owner.userId, true);
			expect(stats).toMatchObject({ totalSubscriptions: 3, activeSubscriptions: 2 });
		});

		it("falls back to the registration time for a device never used", async () => {
			const createdAt = new Date("2026-09-01T10:00:00Z");
			repository.listByUser.mockResolvedValueOnce([
				{ id: "s1", deviceName: null, lastUsedAt: null, createdAt },
			]);

			const stats = await service.stats(owner);

			// `createdAt` and NOT `now()`: "never used" genuinely means "not used since
			// registration", and substituting the current time would make an unused device look
			// like the most recently active one.
			expect(stats.devices[0]).toEqual({ deviceName: "Unknown Device", lastUsed: createdAt });
		});

		it("defaults an unnamed device rather than rendering an empty label", async () => {
			repository.listByUser.mockResolvedValueOnce([
				{ id: "s1", deviceName: null, lastUsedAt: null, createdAt: new Date() },
			]);

			const stats = await service.stats(owner);
			expect(stats.devices[0]?.deviceName).toBe("Unknown Device");
		});
	});

	describe("publicKey", () => {
		it("generates and stores a keypair on first use", async () => {
			await service.publicKey(owner);
			expect(repository.insertVapidKeys).toHaveBeenCalledTimes(1);
		});

		it("returns the existing public key without minting another", async () => {
			repository.findVapidKeys.mockResolvedValueOnce({
				userId: owner.userId,
				publicKey: "existing-public",
				privateKey: "p",
				subject: "s",
			});

			await expect(service.publicKey(owner)).resolves.toEqual({ publicKey: "existing-public" });
			expect(repository.insertVapidKeys).not.toHaveBeenCalled();
		});
	});

	describe("recordDelivery", () => {
		it("records a successful delivery as usage", async () => {
			await service.recordDelivery("sub-1", { delivered: true, gone: false });
			expect(repository.markUsed).toHaveBeenCalledWith("sub-1");
			expect(repository.deactivate).not.toHaveBeenCalled();
		});

		it("retires an endpoint the push service rejected", async () => {
			// A 404/410 endpoint will never work again, so retrying it forever wastes every
			// future send. Marking it inactive keeps the row (a re-subscribe can re-activate it)
			// while removing it from the delivery set.
			await service.recordDelivery("sub-1", { delivered: false, gone: true });

			expect(repository.deactivate).toHaveBeenCalledWith("sub-1");
			expect(repository.markUsed).not.toHaveBeenCalled();
		});

		it("does nothing for a transient failure", async () => {
			// A 500 or a timeout is worth retrying, so neither the usage stamp nor the
			// retirement should happen.
			await service.recordDelivery("sub-1", { delivered: false, gone: false });

			expect(repository.markUsed).not.toHaveBeenCalled();
			expect(repository.deactivate).not.toHaveBeenCalled();
		});
	});

	describe("deliverableCount", () => {
		it("delegates to the CROSS-TABLE count, which excludes banned owners", async () => {
			// Activity is necessary and not sufficient: a ban does not flip the device rows, so
			// the count of `is_active = true` rows alone would include accounts that must not be
			// notified.
			repository.countDeliverable.mockResolvedValueOnce(7);

			await expect(service.deliverableCount()).resolves.toBe(7);
			expect(repository.countDeliverable).toHaveBeenCalled();
		});
	});
});
