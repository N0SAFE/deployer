import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * Approval requests (`SEC-072`).
 *
 * One row per "I want to do X and am not allowed to do it alone". It is bound to the EXACT action by `actionHash` — a
 * sha256 over the procedure, its input and the resource — so an approval cannot be replayed for a different action.
 *
 * `requiredApprovals` is per request, not global: the policy layer decides how many people a risk level needs, and this
 * table is only the ledger. `status` is a closed set so a reader never has to interpret a free string.
 */
export const accessRequests = pgTable("access_requests", {
	id: uuid("id").primaryKey().defaultRandom(),
	/** The capability the requester wants to use (`"deployment:trigger"`). */
	permission: text("permission").notNull(),
	/** Who is asking. A token/agent acts for its owner, and `via` records the credential that made the call. */
	requesterId: text("requester_id").notNull(),
	via: text("via"),
	/** The scope of the action: `{ projectId }`, `{ serviceId }`, `{ platform: true }`. */
	scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
	/** sha256 of the canonical action; single-use, checked again when the approval is consumed. */
	actionHash: text("action_hash").notNull(),
	/** Why — required, and read by whoever has to decide. */
	reason: text("reason").notNull(),
	requiredApprovals: integer("required_approvals").notNull().default(1),
	/** `pending`, `approved`, `denied`, `consumed` or `expired`. */
	status: text("status").notNull().default("pending"),
	ttlSec: integer("ttl_sec").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
	consumedAt: timestamp("consumed_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * One person's verdict on a request.
 *
 * The primary key is `(requestId, approverId)`, so a double click cannot count twice and the quorum count is a
 * `COUNT(*)` over distinct people rather than a counter that could drift.
 */
export const accessRequestVotes = pgTable(
	"access_request_votes",
	{
		requestId: uuid("request_id")
			.notNull()
			.references(() => accessRequests.id, { onDelete: "cascade" }),
		approverId: text("approver_id").notNull(),
		/** `approve` or `deny`; a deny ends the request immediately. */
		decision: text("decision").notNull(),
		at: timestamp("at").defaultNow().notNull(),
	},
	(table) => [primaryKey({ columns: [table.requestId, table.approverId] })],
);
