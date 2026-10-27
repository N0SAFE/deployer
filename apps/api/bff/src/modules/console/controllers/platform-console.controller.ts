import { Controller, Get, HttpException, HttpStatus } from "@nestjs/common";
import { Render as SsrRender } from "@nestjs-ssr/react";

import type { ManagedWebState } from "@deployer/fleet-contracts";
import { EnvService } from "@/config/env/env.module";
import ManagedWebAppView from "@/views/pages/manage-web-app";
import LoginView from "@/views/pages/login";
import { ManagedWebClient } from "../clients/managed-web.client";

/**
 * The management console — the API-rendered fallback for `/manage/*`.
 *
 * ── WHY THE PAGES LIVE HERE AND NOT IN A SERVICE ────────────────────────────
 * They `@Render` React views, and the views are front-facing: they sit in the BFF's
 * `views/` with every other page the platform serves. A service renders no UI, so a
 * service holding a view would be a service that knows what a screen looks like —
 * the boundary this split exists to draw.
 *
 * Actions are NOT handled here. Every control on these pages calls one of the BFF's
 * own `console.*` procedures (`ConsoleControlController`), which reach fleet through
 * its typed client — so each action has ONE implementation on each side of the
 * boundary rather than one per visual.
 */
@Controller("manage")
export class PlatformConsoleController {
	constructor(
		private readonly env: EnvService,
		private readonly managedWeb: ManagedWebClient,
	) {}

	/**
	 * The single console URL. SSR-seeds the state; the view keeps it live over oRPC.
	 *
	 * 404 when an EXTERNAL web app owns this URL: rendering our fallback would show an
	 * operator a console whose controls cannot change anything, which is worse than a
	 * refusal that says why.
	 */
	@Get("web-app")
	@SsrRender(ManagedWebAppView)
	async consolePage(): Promise<{ state: ManagedWebState }> {
		if (this.env.get("MANAGED_WEB_APP_EXTERNAL")) {
			throw new HttpException(
				"Management console disabled: MANAGED_WEB_APP_EXTERNAL=true (an externally managed dev web app is running)",
				HttpStatus.NOT_FOUND,
			);
		}
		return { state: await this.managedWeb.state() };
	}

	/** Login screen — public by design; the SSR guard exempts this path. */
	@Get("login")
	@SsrRender(LoginView)
	login(): { redirect: string; error: string | null } {
		return { redirect: "/manage/web-app", error: null };
	}
}
