import { createHash, randomBytes } from "crypto";
import { ConflictError, ForbiddenError, NotFoundError } from "@deployer/errors";
import { Context, Effect } from "effect";
import { ApiKeyStore } from "../repositories/api-key.repository";
import { assertProjectAccess } from "./project-access";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CreateApiKeyInput = {
	userId: string;
	name: string;
	/** Optional project-scoped key. If provided, ownership is validated. */
	projectId?: string;
	scopes?: string[];
	expiresAt?: Date;
};

export type IssueApiKeyResult = {
	id: string;
	name: string;
	keyPreview: string;
	scopes: string[] | null;
	expiresAt: Date | null;
	createdAt: Date;
	/** Raw API key — returned **only once** at creation. Hash stored in DB. */
	rawKey: string;
};

export type RotateApiKeyResult = {
	/** The newly issued key record. */
	newKey: IssueApiKeyResult;
	/** ID of the revoked predecessor key. */
	revokedKeyId: string;
};

/** The API-key use cases, composed as Effects. */
export class ApiKeyServiceImpl {
	// -----------------------------------------------------------------------
	// Create
	// -----------------------------------------------------------------------

	/**
	 * Issue a new API key.
	 * Returns the raw key **once** — the DB stores only the SHA-256 hash and a preview.
	 */
	createApiKey(input: CreateApiKeyInput) {
		return issueApiKey(input);
	}

	// -----------------------------------------------------------------------
	// Read
	// -----------------------------------------------------------------------

	listUserKeys(userId: string) {
		return Effect.gen(function* () {
			const keys = yield* ApiKeyStore;
			return yield* keys.findByUser(userId);
		});
	}

	listProjectKeys(projectId: string, requesterId: string) {
		return Effect.gen(function* () {
			yield* assertProjectAccess(projectId, requesterId, "admin");
			const keys = yield* ApiKeyStore;
			return yield* keys.findByProject(projectId);
		});
	}

	// -----------------------------------------------------------------------
	// Revoke
	// -----------------------------------------------------------------------

	/**
	 * Permanently disable an API key.
	 * The hash record is kept for audit purposes; `isActive = false` blocks authentication.
	 */
	revokeApiKey(id: string, requesterId: string) {
		return Effect.gen(function* () {
			const keys = yield* ApiKeyStore;
			const key = yield* keys.findById(id);
			if (!key) {
				return yield* Effect.fail(new NotFoundError("API key", id));
			}
			if (key.userId !== requesterId) {
				// Also allow project admins to revoke project-scoped keys
				if (key.projectId) {
					yield* assertProjectAccess(key.projectId, requesterId, "admin");
				} else {
					return yield* Effect.fail(
						new ForbiddenError("You do not have permission to revoke this API key"),
					);
				}
			}
			yield* keys.setActive(id, false);
		});
	}

	// -----------------------------------------------------------------------
	// Rotate
	// -----------------------------------------------------------------------

	/**
	 * Atomically revoke an existing key and issue a replacement.
	 * Returns the new raw key in `newKey.rawKey` — store it immediately.
	 */
	rotateApiKey(id: string, requesterId: string) {
		return Effect.gen(function* () {
			const keys = yield* ApiKeyStore;
			const old = yield* keys.findById(id);
			if (!old) {
				return yield* Effect.fail(new NotFoundError("API key", id));
			}
			if (old.userId !== requesterId) {
				if (old.projectId) {
					yield* assertProjectAccess(old.projectId, requesterId, "admin");
				} else {
					return yield* Effect.fail(
						new ForbiddenError("You do not have permission to rotate this API key"),
					);
				}
			}

			// Revoke the old key first
			yield* keys.setActive(id, false);

			// Issue a fresh replacement with the same name / scopes
			const newKey = yield* issueApiKey({
				userId: old.userId,
				name: old.name,
				projectId: old.projectId ?? undefined,
				scopes: old.scopes ?? undefined,
				expiresAt: old.expiresAt ?? undefined,
			});

			return { newKey, revokedKeyId: id } satisfies RotateApiKeyResult;
		});
	}
}

/** Issue a key: hash it, refuse a collision, persist it. Shared by create and rotate. */
function issueApiKey(input: CreateApiKeyInput) {
	return Effect.gen(function* () {
		if (input.projectId) {
			yield* assertProjectAccess(input.projectId, input.userId, "admin");
		}

		const keys = yield* ApiKeyStore;

		const rawKey = `dk_${randomBytes(32).toString("hex")}`;
		const keyHash = hashKey(rawKey);
		const keyPreview = rawKey.slice(0, 10);

		// Prevent duplicate hashes (astronomically unlikely, but defensive)
		const existing = yield* keys.findByHash(keyHash);
		if (existing) {
			return yield* Effect.fail(new ConflictError("Key collision — please retry"));
		}

		const record = yield* keys.create({
			userId: input.userId,
			name: input.name,
			keyHash,
			keyPreview,
			projectId: input.projectId ?? null,
			scopes: input.scopes ?? null,
			expiresAt: input.expiresAt ?? null,
		});

		return {
			id: record.id,
			name: record.name,
			keyPreview: record.keyPreview,
			scopes: record.scopes ?? null,
			expiresAt: record.expiresAt ?? null,
			createdAt: record.createdAt,
			rawKey,
		};
	});
}

/** SHA-256 hash of raw key — stored in DB for constant-time lookup. */
function hashKey(rawKey: string): string {
	return createHash("sha256").update(rawKey).digest("hex");
}

/** The service's public surface is exactly the implementation's methods. */
export type ApiKeyServiceShape = ApiKeyServiceImpl;

/** Effect key = NestJS token. */
export class ApiKeyService extends Context.Service<ApiKeyService, ApiKeyServiceShape>()(
	"project/ApiKeyService",
) {}
