/**
 * AppInstanceService — identity layer for deployer web app installations.
 *
 * Tokens are opaque (32 random bytes, base64url). Only the SHA-256 hash is
 * stored. The raw token is returned exactly once at registration/provisioning.
 * Heartbeats keep instances "active"; stale/revoked instances fail gateway
 * verification immediately.
 */

import { Injectable, Logger } from "@nestjs/common";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";

import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import { appInstances, type AppInstanceEntity } from "@/config/drizzle/global/schema";

/** Instances without a heartbeat for this long become stale. */
export const STALE_AFTER_MS = 30 * 60 * 1000;
/** Stale instances older than this are auto-revoked by the sweeper. */
const AUTO_REVOKE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export interface MintedToken {
	instanceId: string;
	/** Raw token — handed to the caller once, never persisted in clear. */
	appToken: string;
}

@Injectable()
export class AppInstanceService {
	private readonly logger = new Logger(AppInstanceService.name);

	constructor(private readonly db: GlobalDatabaseService) {}

	/** Create an instance and mint its one-time token. */
	async create(input: {
		label: string;
		kind: "managed" | "external";
		createdByUserId?: string | null;
	}): Promise<MintedToken> {
		const raw = randomBytes(32).toString("base64url");
		const tokenHash = this.hash(raw);

		const [row] = await this.db.db
			.insert(appInstances)
			.values({
				label: input.label,
				kind: input.kind,
				tokenHash,
				status: "active",
				createdByUserId: input.createdByUserId ?? null,
			})
			.returning();

		if (row === undefined) {
			throw new Error("app instance insert returned no row");
		}
		this.logger.log(`Created ${input.kind} app instance "${input.label}" (${row.id})`);
		return { instanceId: row.id, appToken: raw };
	}

	/**
	 * Verify a raw token for gateway enforcement.
	 * Returns the instance when active; null when unknown/revoked/stale-expired.
	 */
	async verifyByToken(rawToken: string): Promise<AppInstanceEntity | null> {
		const tokenHash = this.hash(rawToken);
		const rows = await this.db.db
			.select()
			.from(appInstances)
			.where(eq(appInstances.tokenHash, tokenHash))
			.limit(1);

		const row = rows[0];
		if (row === undefined) return null;
		if (row.status !== "active") return null;
		return row;
	}

	/** Heartbeat: bump lastSeenAt; reactivates stale instances. Null when revoked/unknown. */
	async heartbeat(rawToken: string): Promise<Date | null> {
		const tokenHash = this.hash(rawToken);
		const updated = await this.db.db
			.update(appInstances)
			.set({ lastSeenAt: new Date(), status: "active", updatedAt: new Date() })
			.where(and(eq(appInstances.tokenHash, tokenHash), eq(appInstances.status, "active")))
			.returning({ lastSeenAt: appInstances.lastSeenAt });

		const row = updated[0];
		if (row !== undefined) return row.lastSeenAt;

		// Stale-but-not-revoked heartbeats reactivate the instance.
		const revived = await this.db.db
			.update(appInstances)
			.set({ lastSeenAt: new Date(), status: "active", updatedAt: new Date() })
			.where(and(eq(appInstances.tokenHash, tokenHash), eq(appInstances.status, "stale")))
			.returning({ lastSeenAt: appInstances.lastSeenAt });
		const revivedRow = revived[0];
		return revivedRow?.lastSeenAt ?? null;
	}

	/** List all instances (admin surface) — never exposes token hashes. */
	async list(): Promise<AppInstanceEntity[]> {
		return await this.db.db.select().from(appInstances);
	}

	/** Revoke by id. Idempotent. Returns true when a live instance was revoked. */
	async revoke(instanceId: string): Promise<boolean> {
		const updated = await this.db.db
			.update(appInstances)
			.set({ status: "revoked", updatedAt: new Date() })
			.where(and(eq(appInstances.id, instanceId)))
			.returning({ id: appInstances.id, status: appInstances.status });
		const row = updated[0];
		if (row === undefined || row.status !== "revoked") return false;
		this.logger.warn(`Revoked app instance ${instanceId}`);
		return true;
	}

	/**
	 * Sweeper: mark silent instances stale, auto-revoke long-dead ones.
	 * Called periodically (console refresh / orchestrator tick).
	 */
	async sweepStale(now = new Date()): Promise<void> {
		await this.db.db
			.update(appInstances)
			.set({ status: "stale", updatedAt: now })
			.where(
				and(
					eq(appInstances.status, "active"),
					lt(appInstances.lastSeenAt, new Date(now.getTime() - STALE_AFTER_MS)),
				),
			);
		await this.db.db
			.update(appInstances)
			.set({ status: "revoked", updatedAt: now })
			.where(
				and(
					eq(appInstances.status, "stale"),
					lt(appInstances.updatedAt, new Date(now.getTime() - AUTO_REVOKE_AFTER_MS)),
				),
			);
	}

	/** Find the managed instance (spawned by this API), if any. */
	async findManaged(): Promise<AppInstanceEntity | null> {
		const rows = await this.db.db
			.select()
			.from(appInstances)
			.where(and(eq(appInstances.kind, "managed"), eq(appInstances.status, "active")))
			.limit(1);
		return rows[0] ?? null;
	}

	private hash(rawToken: string): string {
		return createHash("sha256").update(rawToken).digest("hex");
	}
}
