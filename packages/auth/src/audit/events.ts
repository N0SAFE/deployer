import z from "zod/v4";

/**
 * The auth events the platform records.
 *
 * The list is code, not data, for the same reason the permission vocabulary is: an event name is read by the audit
 * viewer and written by one producer, so a typo should fail the build rather than silently produce a row no filter
 * matches.
 */
export const AUTH_AUDIT_ACTIONS = [
	"sign-in",
	"sign-out",
	"user-created",
	"user-deleted",
	"email-change",
	"role-change",
	"role-created",
	"role-updated",
	"role-deleted",
	"ban",
	"unban",
	"password-changed",
	"two-factor-enabled",
	"passkey-added",
	"api-key-created",
	"api-key-revoked",
	"invite-created",
	"invite-accepted",
	"device-approved",
	"impersonation-start",
	"impersonation-stop",
	"impersonation-writes-enabled",
	"approval-requested",
	"approval-decided",
	"approval-consumed",
] as const;

export type AuthAuditAction = (typeof AUTH_AUDIT_ACTIONS)[number];

/**
 * One recorded event.
 *
 * `detail` carries the action-specific facts (the granted role, the key id) and never a credential: this row is read by
 * whoever holds `audit:read`, which is a wider audience than the action's own capability.
 */
export const authAuditEventSchema = z.object({
	action: z.enum(AUTH_AUDIT_ACTIONS),
	/** Who caused it, when the request was authenticated. */
	actorId: z.string().min(1).optional(),
	/** Who it happened to, when the action names a subject. */
	targetId: z.string().min(1).optional(),
	ip: z.string().optional(),
	userAgent: z.string().optional(),
	detail: z.record(z.string(), z.unknown()).optional(),
});

export type AuthAuditEvent = z.infer<typeof authAuditEventSchema>;

/**
 * Where a produced event goes.
 *
 * `record` is deliberately fire-and-forget and must never throw: an audit write that fails must not fail the sign-in
 * it describes, and the auth boundary has nowhere to return an error for "the log is down". A sink reports its own
 * failures (a counter, a log line) — the producer cannot.
 */
export interface AuthAuditSink {
	record: (event: AuthAuditEvent) => void;
}
