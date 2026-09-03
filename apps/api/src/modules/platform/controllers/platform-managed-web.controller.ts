/**
 * PlatformManagedWebController — ORPC ops powering the BEAUTIFUL managed web
 * console inside the web app (the visual Traefik routes `/manage/web-app` to
 * when the web app is enabled).
 *
 * Public (like the HTML console it parallels): the single console URL must
 * keep working logged-out — the parallel API HTML console is anonymous, and
 * the state query doubles as the "is the web app down?" fallback status.
 * All logic delegates to PlatformManagedWebService (shared with the HTML
 * console controller).
 */

import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { appContract } from "@repo/api-contracts";
import { PlatformManagedWebService } from "../services/platform-managed-web.service";

@Controller()
export class PlatformManagedWebController {
	constructor(private readonly managedWeb: PlatformManagedWebService) {}

	@Implement(appContract.platform.getManagedWebState)
	state() {
		return implement(appContract.platform.getManagedWebState).handler(
			async () => this.managedWeb.state(),
		);
	}

	@Implement(appContract.platform.toggleManagedWeb)
	toggle() {
		return implement(appContract.platform.toggleManagedWeb).handler(async () => {
			const state = await this.managedWeb.toggle();
			return { status: 201 as const, body: { state } };
		});
	}

	@Implement(appContract.platform.restartManagedWeb)
	restart() {
		return implement(appContract.platform.restartManagedWeb).handler(async () => {
			const state = await this.managedWeb.restart();
			return { status: 201 as const, body: { state } };
		});
	}

	@Implement(appContract.platform.setManagedWebOrigin)
	setOrigin() {
		return implement(appContract.platform.setManagedWebOrigin).handler(
			async ({ input }) => {
				const state = await this.managedWeb.setOrigin(input.origin);
				return { status: 201 as const, body: { state } };
			},
		);
	}

	@Implement(appContract.platform.enableManagedWebTunnel)
	enableTunnel() {
		return implement(appContract.platform.enableManagedWebTunnel).handler(
			async ({ input }) => {
				const state = await this.managedWeb.enableTunnel(input.hostname);
				return { status: 201 as const, body: { state } };
			},
		);
	}

	@Implement(appContract.platform.disableManagedWebTunnel)
	disableTunnel() {
		return implement(appContract.platform.disableManagedWebTunnel).handler(async () => {
			const state = await this.managedWeb.disableTunnel();
			return { status: 201 as const, body: { state } };
		});
	}
}