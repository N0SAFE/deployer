import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Step-up proofs — append-only (`AUTH-062`).
 *
 * A step-up is the answer to "this session proved a fresh, phishing-resistant factor a moment ago". It is bound to the
 * SESSION (`AUTH-062` forbids using `session.freshAge` for it): a passkey tap in one browser must not authorise a
 * destructive action taken from another device holding the same account's cookie.
 *
 * One row per successful verification. Readers ask "is there a row for THIS session newer than `now - 300s`" and the
 * index is `(session_id, verified_at)` for exactly that question.
 *
 * `method` is the factor that produced it: `passkey` is AAL3 (user-verified, phishing-resistant), `totp` is AAL2
 * (possession only). The design requires AAL3 for critical actions, so a future guard reads this column rather than
 * treating every row as equal.
 */
export const stepUpEvents = pgTable(
	"step_up_events",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		/** The Better Auth session that performed the verification. */
		sessionId: text("session_id").notNull(),
		/** The user the session belongs to, duplicated so a read does not need a join. */
		userId: text("user_id").notNull(),
		/** `passkey` (AAL3) or `totp` (AAL2). */
		method: text("method").notNull(),
		/** Why the caller asked for it, as the endpoint recorded it. */
		reason: text("reason"),
		/** Verification facts that are not credentials: the credential id, the authenticator's transport. */
		detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
		verifiedAt: timestamp("verified_at").defaultNow().notNull(),
	},
	(table) => [
		index("step_up_events_session_idx").on(table.sessionId, table.verifiedAt),
		index("step_up_events_user_idx").on(table.userId, table.verifiedAt),
	],
);
