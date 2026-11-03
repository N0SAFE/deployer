import { oc } from "@orpc/contract";
import z from "zod/v4";

import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/** The lifecycle of a request. A closed set, so a reader never has to interpret a free string. */
export const accessRequestStatusSchema = z.enum(["pending", "approved", "denied", "expired", "consumed"]);

export const accessRequestSchema = z.object({
	id: z.string(),
	/** The capability the requester wants to use. */
	permission: z.string(),
	requesterId: z.string(),
	/** Display name of the requester, so an approver does not decide on an opaque id. */
	requesterName: z.string().nullable(),
	via: z.string().nullable(),
	scope: z.record(z.string(), z.unknown()),
	/** sha256 of the canonical action; an approval is single-use and bound to exactly this. */
	actionHash: z.string(),
	reason: z.string(),
	requiredApprovals: z.number().int(),
	status: accessRequestStatusSchema,
	ttlSec: z.number().int(),
	expiresAt: z.coerce.date(),
	consumedAt: z.coerce.date().nullable(),
	createdAt: z.coerce.date(),
	/** Distinct people who said yes, so a UI can show "1 of 2". */
	approvals: z.number().int(),
});

export type AccessRequest = z.infer<typeof accessRequestSchema>;

const approvalOps = standard.zod(accessRequestSchema, "approvalRequest");

const requestBodySchema = z.object({
	permission: z.string().min(3),
	scope: z.record(z.string(), z.unknown()).default({}),
	actionHash: z.string().min(16),
	reason: z.string().min(5),
	ttlSec: z.coerce.number().int().min(60).max(86_400).default(3600),
	requiredApprovals: z.coerce.number().int().min(1).max(3).default(1),
});

/**
 * Ask for a second person (`SEC-072`).
 *
 * Not a capability: every signed-in account may ask for what it cannot do alone. `actionHash` binds the approval to the
 * exact action, so approving "delete project X" cannot be replayed for "delete project Y".
 */
export const approvalRequestContract = approvalOps
	.create()
	.path("/approvals")
	.input((b) => b.body(requestBodySchema))
	.output(accessRequestSchema)
	.tags("Approvals")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Pending (or filtered) requests an approver may act on; `approval:read`. */
export const approvalListContract = approvalOps
	.list()
	.path("/approvals")
	.input((b) =>
		b.query(
			z.object({
				status: accessRequestStatusSchema.default("pending"),
				limit: z.coerce.number().int().min(1).max(100).default(50),
			}),
		),
	)
	.output(z.object({ data: z.array(accessRequestSchema) }))
	.tags("Approvals")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * Approve or deny (`approval:approve`).
 *
 * Three refusals the service makes: the requester cannot decide their own request, the caller needs a fresh passkey
 * proof, and a request that expired or was already decided is not reopened.
 */
export const approvalDecideContract = approvalOps
	.create()
	.path("/approvals/{id}/decide")
	.input((b) =>
		b.params(z.object({ id: z.uuid() })).body(z.object({ decision: z.enum(["approve", "deny"]) })),
	)
	.output(accessRequestSchema)
	.tags("Approvals")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * Spend an approved request (`SEC-072`).
 *
 * The requester calls this when it retries the action; the row is consumed ATOMICALLY only when the hash matches, so two
 * retries cannot both proceed on one approval. A guard calls the same store method inside the action it protects.
 */
export const approvalConsumeContract = approvalOps
	.create()
	.path("/approvals/consume")
	.input((b) => b.body(z.object({ actionHash: z.string().min(16) })))
	.output(z.object({ consumed: z.boolean() }))
	.tags("Approvals")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** The approval namespace the service exposes. */
export const approvalContract = oc.router({
	request: approvalRequestContract,
	list: approvalListContract,
	decide: approvalDecideContract,
	consume: approvalConsumeContract,
});

export type ApprovalContract = typeof approvalContract;
