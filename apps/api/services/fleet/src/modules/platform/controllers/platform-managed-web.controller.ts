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
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { platformContract } from "@repo/api-contracts";
import { PlatformManagedWebService } from "../services/platform-managed-web.service";

@Controller()
export class PlatformManagedWebController {
	constructor(private readonly managedWeb: PlatformManagedWebService) {}

	@Implement(platformContract.getManagedWebState)
	state() {
		return implement(platformContract.getManagedWebState).handler(
			async () => this.managedWeb.state(),
		);
	}

	@Implement(platformContract.toggleManagedWeb)
	toggle() {
		return implement(platformContract.toggleManagedWeb).handler(async () => {
			const state = await this.managedWeb.toggle();
			return { status: 201 as const, body: { state } };
		});
	}

	@Implement(platformContract.restartManagedWeb)
	restart() {
		return implement(platformContract.restartManagedWeb).handler(async () => {
			const state = await this.managedWeb.restart();
			return { status: 201 as const, body: { state } };
		});
	}

	@Implement(platformContract.setManagedWebOrigin)
	setOrigin() {
		return implement(platformContract.setManagedWebOrigin).handler(
			async ({ input }) => {
				const state = await this.managedWeb.setOrigin(input.origin);
				return { status: 201 as const, body: { state } };
			},
		);
	}

	@Implement(platformContract.enableManagedWebTunnel)
	enableTunnel() {
		return implement(platformContract.enableManagedWebTunnel).handler(
			async ({ input }) => {
				const state = await this.managedWeb.enableTunnel(input.hostname);
				return { status: 201 as const, body: { state } };
			},
		);
	}

	@Implement(platformContract.disableManagedWebTunnel)
	disableTunnel() {
		return implement(platformContract.disableManagedWebTunnel).handler(async () => {
			const state = await this.managedWeb.disableTunnel();
			return { status: 201 as const, body: { state } };
		});
	}
}