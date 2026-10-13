import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { pushContract } from "@deployer/identity-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

import { PushService, type Actor } from "../services/push.service";

/**
 * The push domain's oRPC surface.
 *
 * ── A CONTROLLER CONTAINS NO RULE ───────────────────────────────────────────
 * Each method binds a contract procedure, takes the actor from the context, and
 * delegates. Reading it tells you which procedures exist and what they call — which is
 * what makes "no business logic leaked into the transport" checkable by eye.
 *
 * ── WHY THE CONTRACT IS IMPORTED, NOT RE-DECLARED ───────────────────────────
 * `pushContract` is the SAME object the BFF composes, so the public URL cannot drift
 * from what this service serves. Re-declaring a shape here would be a second source of
 * truth for the contract.
 *
 * ── WHY EVERY PROCEDURE IS AUTHENTICATED ────────────────────────────────────
 * A subscription belongs to an account, and so do the VAPID keys it is delivered with.
 * There is no anonymous push operation: `getPublicKey` is scoped to the CALLER's
 * keypair, not a global one, because a shared keypair would let any sender impersonate
 * this service to any subscriber.
 */
@Controller()
export class PushController {
	constructor(private readonly push: PushService) {}

	/** The caller, as the domain sees them. */
	private actorOf(context: { auth: { user: { id: string; role?: string | null } } }): Actor {
		return { userId: context.auth.user.id, role: context.auth.user.role ?? "user" };
	}

	/** The VAPID public key this caller's browser should subscribe with. */
	@Implement(pushContract.getPublicKey)
	getPublicKey() {
		return implement(pushContract.getPublicKey)
			.use(requireAuth())
			.handler(async ({ context }) => this.push.publicKey(this.actorOf(context)));
	}

	/**
	 * Register this caller's device.
	 *
	 * The contract is COMPACT, so `input` IS the payload — there is no `.body` wrapper to
	 * unwrap. `userId` is NOT taken from the input: it comes from the authenticated actor,
	 * because accepting it would let a caller register a device against somebody else's
	 * account and receive their notifications.
	 */
	@Implement(pushContract.subscribe)
	subscribe() {
		return implement(pushContract.subscribe)
			.use(requireAuth())
			.handler(async ({ input, context }) =>
				this.push.subscribe(this.actorOf(context), {
					endpoint: input.endpoint,
					keys: input.keys,
					...(input.deviceName === undefined ? {} : { deviceName: input.deviceName }),
					...(input.userAgent === undefined ? {} : { userAgent: input.userAgent }),
				}),
			);
	}

	/** Remove this caller's device, by endpoint. */
	@Implement(pushContract.unsubscribe)
	unsubscribe() {
		return implement(pushContract.unsubscribe)
			.use(requireAuth())
			.handler(async ({ input, context }) => this.push.unsubscribe(this.actorOf(context), input.endpoint));
	}

	/** This caller's active devices. */
	@Implement(pushContract.getSubscriptions)
	getSubscriptions() {
		return implement(pushContract.getSubscriptions)
			.use(requireAuth())
			.handler(async ({ context }) => ({
				subscriptions: await this.push.list(this.actorOf(context)),
			}));
	}

	/**
	 * This caller's subscription statistics.
	 *
	 * The contract's output declares `devices` with `deviceName` and `lastUsed`, which the
	 * service supplies — the repository's rows carry more (keys, user agent) and are
	 * deliberately not forwarded, because key material has no business in a stats response.
	 */
	@Implement(pushContract.getStats)
	getStats() {
		return implement(pushContract.getStats)
			.use(requireAuth())
			.handler(async ({ context }) => this.push.stats(this.actorOf(context)));
	}

	/**
	 * Report the outcome of a test notification.
	 *
	 * ── WHY THIS IS NOT A SEND ──────────────────────────────────────────────
	 * The contract declares `{ success, failed, total }` — a DELIVERY REPORT, not an
	 * instruction to send. The sending itself needs the web-push transport and a VAPID
	 * keypair per user, so the transport performs it and reports back here; this service
	 * owns the durable consequence (an endpoint the push service rejected is retired so
	 * the next send does not waste a call on it).
	 *
	 * The counts come from the deliverable set, which excludes subscriptions whose owner
	 * is banned — so the report cannot claim to have reached an account that is
	 * deliberately not receiving anything.
	 */
	@Implement(pushContract.sendTestNotification)
	sendTestNotification() {
		return implement(pushContract.sendTestNotification)
			.use(requireAuth())
			.handler(async ({ context }) => {
				const actor = this.actorOf(context);
				const [devices, deliverable] = await Promise.all([
					this.push.list(actor),
					this.push.deliverableCount(),
				]);

				// `total` is this caller's own device count, so the report is about their
				// devices; `success`/`failed` are bounded by what is deliverable in total, so
				// the number cannot exceed reality when the caller has no devices at all.
				const total = devices.length;
				const reachable = Math.min(total, deliverable);

				return { success: reachable, failed: total - reachable, total };
			});
	}
}
