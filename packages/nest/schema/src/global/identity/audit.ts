import {
    bigserial,
    index,
    jsonb,
    pgTable,
    text,
    timestamp,
} from 'drizzle-orm/pg-core'

/**
 * Auth audit trail — append-only.
 *
 * Every row is an event that already happened: sign-in, sign-out, a role change, a ban, a key minted or revoked. The
 * table has no `updated_at` and no writer path that updates a row, so "what did the platform record" is answered by an
 * ordered read, not by reconstructing state.
 *
 * Why a table of its own instead of `core_event_logs`: the audit trail must be readable by an operator with the
 * `audit:read` capability (`AUTH-029`), and the event journal's `(namespace, event_name, event_key, sequence)` shape
 * describes replay cursors, not an audit question. An auth event is produced once, by the auth boundary, and only read.
 */
export const authAuditEvents = pgTable(
    'auth_audit_events',
    {
        /** Insertion order. An audit read is chronological, so the sequence is the id. */
        id: bigserial('id', { mode: 'number' }).primaryKey(),
        /** The action, from the catalog in `@deployer/auth/audit` (`sign-in`, `role-change`, …). */
        action: text('action').notNull(),
        /** Who caused it, when the request was authenticated. */
        actorId: text('actor_id'),
        /** Who it happened to, when the action names a subject (the user a role was granted to). */
        targetId: text('target_id'),
        /** Forwarded client address, as the session itself records it. */
        ip: text('ip'),
        userAgent: text('user_agent'),
        /** Action-specific facts: the previous and new role, the key id, the refusal reason. Never a secret. */
        detail: jsonb('detail')
            .$type<Record<string, unknown>>()
            .notNull()
            .default({}),
        createdAt: timestamp('created_at').defaultNow().notNull(),
    },
    (table) => [
        index('auth_audit_events_action_idx').on(table.action),
        index('auth_audit_events_actor_idx').on(table.actorId),
        index('auth_audit_events_target_idx').on(table.targetId),
        index('auth_audit_events_created_at_idx').on(table.createdAt),
    ]
)
