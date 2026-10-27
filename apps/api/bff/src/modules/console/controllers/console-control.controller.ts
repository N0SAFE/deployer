import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";

import { bffConsoleContract } from "@deployer/bff-contracts";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { ManagedWebClient } from "../clients/managed-web.client";

/**
 * The console's control panel, as typed procedures.
 *
 * ── WHY THESE ARE THE BFF'S PROCEDURES AND NOT FLEET'S ──────────────────────
 * The state and the actions belong to fleet, and this controller reaches them
 * through fleet's own typed client — exactly like every other composition module.
 * What makes them the BFF's surface is that the PAGE they drive is the API's
 * rendered fallback, served at the same URL as the web app. A service renders no
 * UI, so a service holding this surface would have to know what a screen looks like.
 *
 * ── WHY `webState` IS PUBLIC AND THE MUTATIONS ARE NOT ──────────────────────
 * The console is the fallback an operator reaches when the web app is STOPPED —
 * which is often when they are not logged into the web app either. Reading the state
 * is what the page needs to render at all, so refusing it would make the fallback
 * unusable in the situation it exists for. Changing platform state is a different
 * matter, and matches the authorization fleet already applies: the mutations require
 * a session on both sides of the boundary.
 *
 * ── WHY A METHOD PER ACTION, NOT ONE PASS-THROUGH ───────────────────────────
 * Each is a distinct platform operation with its own input. Folding them into a
 * single "call platform with this payload" procedure would re-create, inside the
 * BFF, the open proxy surface this design exists to remove.
 */
@Controller()
export class ConsoleControlController {
	constructor(private readonly managedWeb: ManagedWebClient) {}

	/** The managed web app's current state. */
	@Implement(bffConsoleContract.webState)
	webState() {
		return implement(bffConsoleContract.webState).handler(async () => {
			return this.managedWeb.state();
		});
	}

	/** Flip the enabled flag and converge. */
	@Implement(bffConsoleContract.toggleWeb)
	toggleWeb() {
		return implement(bffConsoleContract.toggleWeb)
			.use(requireAuth())
			.handler(async () => {
				return this.managedWeb.toggle();
			});
	}

	/** Force a restart of the managed web container (also enables it). */
	@Implement(bffConsoleContract.restartWeb)
	restartWeb() {
		return implement(bffConsoleContract.restartWeb)
			.use(requireAuth())
			.handler(async () => {
				return this.managedWeb.restart();
			});
	}

	/** Set, or clear with null, the custom public origin. */
	@Implement(bffConsoleContract.setWebOrigin)
	setWebOrigin() {
		return implement(bffConsoleContract.setWebOrigin)
			.use(requireAuth())
			.handler(async ({ input }) => {
				return this.managedWeb.setOrigin(input);
			});
	}

	/** Provision the web app's own tunnel. */
	@Implement(bffConsoleContract.enableWebTunnel)
	enableWebTunnel() {
		return implement(bffConsoleContract.enableWebTunnel)
			.use(requireAuth())
			.handler(async ({ input }) => {
				return this.managedWeb.enableTunnel(input);
			});
	}

	/** Remove the web app's own tunnel. */
	@Implement(bffConsoleContract.disableWebTunnel)
	disableWebTunnel() {
		return implement(bffConsoleContract.disableWebTunnel)
			.use(requireAuth())
			.handler(async () => {
				return this.managedWeb.disableTunnel();
			});
	}
}
