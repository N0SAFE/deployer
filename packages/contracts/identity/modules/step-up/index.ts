import { oc } from "@orpc/contract";
import { openapi } from "@orpc/openapi";
import z from "zod/v4";

/** The factors a step-up can be proved with. */
export const stepUpMethodSchema = z.enum(["passkey", "totp"]);

/**
 * Whether the CALLER'S SESSION has stepped up recently (`AUTH-062`).
 *
 * `steppedUp` answers "a proof exists inside the window"; `critical` answers the stricter question a destructive action
 * asks, "and it is phishing-resistant" (a passkey). A UI shows the countdown, but the API re-answers on every critical
 * call: this is a read, never the gate.
 */
export const stepUpStatusContract = oc
	.meta(openapi({ method: "GET", path: "/authz/step-up", tags: ["Step-up"] }))
	.input(z.object({}))
	.output(
		z.object({
			steppedUp: z.boolean(),
			critical: z.boolean(),
			method: stepUpMethodSchema.nullable(),
			verifiedAt: z.coerce.date().nullable(),
			expiresAt: z.coerce.date().nullable(),
			windowSeconds: z.number().int(),
		}),
	);

/** The step-up namespace the service exposes. */
export const stepUpContract = oc.router({
	status: stepUpStatusContract,
});

export type StepUpContract = typeof stepUpContract;
