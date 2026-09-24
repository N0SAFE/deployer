/**
 * SetupPageController — serves the onboarding wizard from the API.
 *
 * WHY: setup is the one phase where the web app cannot be assumed to exist.
 * `platform-managed-web` is activated THROUGH the setup flow, so it can never
 * be the surface that runs it — serving onboarding from the API breaks that
 * circular dependency. The API is listening on the entry port from the first
 * second, so the wizard is always reachable.
 *
 * LAYOUT: rendered with `layout: null` — the wizard is a full-page, focused
 * experience (no console chrome), matching what the web app used to render.
 *
 * DATA: `needsSetup` comes from InitializationService (local SQLite), so the
 * page renders correctly before any global database exists.
 */

import { Controller, Get } from "@nestjs/common";
import { Render as SsrRender } from "@nestjs-ssr/react";

import SetupView from "@/views/pages/setup";
import { InitializationService } from "@/core/modules/setup/services/initialization.service";

@Controller()
export class SetupPageController {
	constructor(private readonly initializationService: InitializationService) {}

	/**
	 * `GET /setup` — the onboarding page.
	 *
	 * `needsSetup: false` still renders the page (which then hands the operator
	 * to the web app) rather than redirecting server-side: the redirect target
	 * depends on the REQUEST hostname (api.<host> → web.<host>), which is only
	 * known client-side. Rendering + handing off keeps that decision in one
	 * place (`resolvePostSetupRedirect`) instead of duplicating it here.
	 */
	@Get("setup")
	@SsrRender(SetupView, { layout: null })
	async setupPage(): Promise<{ needsSetup: boolean }> {
		const state = await this.initializationService.getSetupState();
		return { needsSetup: state.needsSetup };
	}
}
