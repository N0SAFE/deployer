import { oc } from "@orpc/contract";
import z from "zod/v4";

import { access } from "@deployer/auth/authz/meta";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

/** The factors a step-up can be proved with. */
export const stepUpMethodSchema = z.enum(["passkey", "totp"]);

const stepUpStatusSchema = z.object({
	steppedUp: z.boolean(),
	critical: z.boolean(),
	method: stepUpMethodSchema.nullable(),
	verifiedAt: z.coerce.date().nullable(),
	expiresAt: z.coerce.date().nullable(),
	windowSeconds: z.number().int(),
});

const stepUpOps = standard.zod(stepUpStatusSchema, "stepUpStatus");

/**
 * Whether the CALLER'S SESSION has stepped up recently (`AUTH-062`).
 *
 * `steppedUp` answers "a proof exists inside the window"; `critical` answers the stricter question a destructive action
 * asks, "and it is phishing-resistant" (a passkey). A UI shows the countdown, but the API re-answers on every critical
 * call: this is a read, never the gate.
 */
export const stepUpStatusContract = stepUpOps
	.read()
	.path("/authz/step-up")
	.input(z.object({}))
	.output(stepUpStatusSchema)
	.tags("Step-up")
	.errors((e) => [...standardDomainErrorContracts(e)])
	.meta(access({ self: true, reason: "the caller reads their own step-up state" })).build();

/** The step-up namespace the service exposes. */
export const stepUpContract = oc.router({
	status: stepUpStatusContract,
});

export type StepUpContract = typeof stepUpContract;
