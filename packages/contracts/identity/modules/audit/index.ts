import { oc } from "@orpc/contract";
import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

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

/** The filters the audit surfaces share; every field is optional and the server owns the defaults. */
export const auditFiltersSchema = z.object({
	action: z.string().optional(),
	actorId: z.string().optional(),
	targetId: z.string().optional(),
	/** Cursor: return rows strictly older than this id (the viewer's "load more"). */
	beforeId: z.coerce.number().int().positive().optional(),
});

const auditOps = standard.zod(authAuditEventRowSchema, "auditEvent");

/** The page the viewer renders: a bounded slice plus whether older rows exist. */
const auditPageSchema = z.object({
	data: z.array(authAuditEventRowSchema),
	meta: z.object({ limit: z.number().int(), hasMore: z.boolean() }),
});

/**
 * The audit log, newest first.
 *
 * `audit:read` guards it: the rows are what an operator needs after an incident, and they name actors and targets.
 */
export const auditListContract = auditOps
	.list()
	.path("/audit")
	.input((b) =>
		b.query(
			auditFiltersSchema.extend({
				limit: z.coerce.number().int().min(1).max(200).default(50),
			}),
		),
	)
	.output(auditPageSchema)
	.tags("Audit")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "audit:read" })).build();

/** The same rows as CSV, bounded at 5000 with a `truncated` flag so a capped export never looks complete. */
export const auditExportContract = auditOps
	.list()
	.path("/audit/export")
	.input((b) =>
		b.query(
			auditFiltersSchema.extend({
				limit: z.coerce.number().int().min(1).max(5000).default(1000),
			}),
		),
	)
	.output(
		z.object({
			csv: z.string(),
			rows: z.number().int(),
			truncated: z.boolean(),
		}),
	)
	.tags("Audit")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ permission: "audit:export" })).build();

/** The audit namespace the BFF delegates to `identity`. */
export const auditContract = oc.router({
	list: auditListContract,
	export: auditExportContract,
});

export type AuditContract = typeof auditContract;
