import { Controller, Get } from "@nestjs/common";
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
		const state = await this.managedWeb.state();

		// `enabled` alone is not enough, and `external` is a separate concern:
		//   - an ENABLED app can still be stopped or degraded, and linking to its
		//     hostname then lands the operator on a 502;
		//   - `external` means compose owns the web app beside this one, so its
		//     lifecycle is a developer's business and this page must not claim to have
		//     started it.
		// `healthy === true` is the only value meaning "there is something to open";
		// the console is always reachable, so it is the safe default.
		const webAppEnabled = state.enabled && !state.external && state.healthy === true;

		if (webAppEnabled) {
			return {
				primaryHref: this.hostnames.webOrigin(),
				primaryLabel: "Open the dashboard",
				webAppEnabled: true,
			};
		}

		return {
			// Relative on purpose: the console is served by the BFF on every platform
			// hostname, so a relative path resolves against whichever host the operator
			// actually used — no cross-origin hop, no hostname reconstruction.
			primaryHref: "/manage/web-app",
			primaryLabel: "Open the management console",
			webAppEnabled: false,
		};
	}
}
