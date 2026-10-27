import { Controller, Get, Logger } from "@nestjs/common";
import { Render as SsrRender } from "@nestjs-ssr/react";

import { AllowAnonymous } from "@/core/modules/auth/decorators/decorators";
import { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import SetupDoneView from "@/views/pages/setup-done";
import { ManagedWebClient } from "../clients/managed-web.client";

/**
 * The page `setup.<host>` serves once onboarding is complete.
 *
 * ── WHY IT IS A PAGE AND NOT A WIZARD STEP ──────────────────────────────────
 * The wizard has finished by the time this renders: the setup app retargeted the
 * ingress, published `ready`, and exited. What remains is a hostname that must still
 * answer, which is this process — so it is an ordinary public page. It is served at
 * the exact path the handover's ingress write points at (`/setup/done`); one spelling
 * of the path is what keeps the page and that write from drifting apart.
 *
 * ── WHY THE DESTINATION IS DECIDED SERVER-SIDE ──────────────────────────────
 * "Where does the operator go now?" depends on whether the managed web app is
 * actually enabled AND healthy — which only the server can know. Deciding it in the
 * browser would flash the wrong button before the answer arrives.
 */
@AllowAnonymous()
@Controller()
export class SetupDoneController {
	private readonly logger = new Logger(SetupDoneController.name);

	constructor(
		private readonly managedWeb: ManagedWebClient,
		private readonly hostnames: HostnameService,
	) {}

	/** The static "setup complete" page. */
	@Get("setup/done")
	@SsrRender(SetupDoneView, { layout: null })
	async donePage(): Promise<{
		primaryHref: string;
		primaryLabel: string;
		webAppEnabled: boolean;
	}> {
		// ── THIS PAGE MUST ANSWER EVEN WHEN THE STATE CANNOT BE READ ──────────
		// `state()` asks FLEET for the managed web app's status, bound with the
		// CALLER's credentials. `/setup/done` is public (`@AllowAnonymous()`), so the
		// caller is usually a browser that has just finished onboarding and holds no
		// session for that service — and the response was
		//
		//   {"statusCode":500,"message":"Internal server error"}
		//   ERROR [ExceptionsHandler] ORPCError: Unauthorized
		//
		// on the ONE page whose entire job is to tell the operator where to go next.
		// A verdict it could not compute is not a reason to fail the page: the console
		// is always reachable, so it is the correct fallback rather than an error.
		const state = await this.managedWeb.state().catch((error: unknown) => {
			const reason = error instanceof Error ? error.message : String(error);
			this.logger.warn(
				`Could not read the managed web app's state — falling back to the console link. Cause: ${reason}`,
			);
			return null;
		});

		// `enabled` alone is not enough, and `external` is a separate concern:
		//   - an ENABLED app can still be stopped or degraded, and linking to its
		//     hostname then lands the operator on a 502;
		//   - `external` means compose owns the web app beside this one, so its
		//     lifecycle is a developer's business and this page must not claim to have
		//     started it.
		// `healthy === true` is the only value meaning "there is something to open";
		// the console is always reachable, so it is the safe default.
		const webAppEnabled = state !== null && state.enabled && !state.external && state.healthy === true;

		if (webAppEnabled) {
			return {
				primaryHref: this.hostnames.webOrigin(),
				primaryLabel: "Open the dashboard",
				webAppEnabled: true,
			};
		}

		return {
			// ── ABSOLUTE, NOT RELATIVE, AND THAT IS THE WHOLE POINT ─────────────
			// This page is reached on `setup.<host>`, and a RELATIVE path resolves
			// against that host — where the console path is not served. Measured on a
			// live run with the previous relative value:
			//
			//   setup.deployer.localhost/manage/web-app  -> 401  ← the operator's dead end
			//   api.deployer.localhost/manage/web-app    -> 200
			//
			// The comment here used to argue that relative "resolves against whichever
			// host the operator used". True, and exactly the bug: the operator used
			// `setup.<host>`, which is precisely the host that does NOT serve the
			// console. The API origin is the one that always does, on every lane, so the
			// link has to name it rather than inherit the page's own.
			primaryHref: `${this.hostnames.apiOrigin()}/manage/web-app`,
			primaryLabel: "Open the management console",
			webAppEnabled: false,
		};
	}
}
