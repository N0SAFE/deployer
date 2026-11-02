import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";

/** One recorded auth audit event, as the admin viewer reads it. */
export const authAuditEventRowSchema = z.object({
	id: z.number().int(),
	action: z.string(),
	actorId: z.string().nullable(),
	targetId: z.string().nullable(),
	ip: z.string().nullable(),
	userAgent: z.string().nullable(),
	detail: z.record(z.string(), z.unknown()),
	createdAt: z.coerce.date(),
});

export type AuthAuditEventRow = z.infer<typeof authAuditEventRowSchema>;

/**
 * The audit log, newest first.
 *
 * `audit:read` guards it: the rows are what an operator needs after an incident, and they name actors and targets.
 */
export const auditListContract = oc
	.meta(openapi({ method: "GET", path: "/audit", tags: ["Audit"] }))
	.input(
		z.object({
			query: z.object({
				action: z.string().optional(),
				actorId: z.string().optional(),
				targetId: z.string().optional(),
				limit: z.coerce.number().int().min(1).max(200).default(50),
				/** Cursor: return rows strictly older than this id (the viewer's "load more"). */
				beforeId: z.coerce.number().int().positive().optional(),
			}),
		}),
	)
	.output(
		z.object({
			data: z.array(authAuditEventRowSchema),
			meta: z.object({ limit: z.number().int(), hasMore: z.boolean() }),
		}),
	);
