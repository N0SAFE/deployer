/**
 * PlatformManagedWebController — ORPC ops powering the BEAUTIFUL managed web
 * console inside the web app (the visual Traefik routes `/manage/web-app` to
 * when the web app is enabled).
 *
 * Public (like the HTML console it parallels): the single console URL must
 * keep working logged-out — the parallel API HTML console is anonymous, and
 * the state query doubles as the "is the web app down?" fallback status.
 * All logic delegates to PlatformManagedWebService, resolved from the module's
 * Effect context and run through `serve` (which provides an anonymous actor
 * for these public calls).
 */

import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { implement } from "@orpc/server";
import { platformContract } from "@deployer/fleet-contracts";
import { EffectContextOf } from "@deployer/nest-effect";

import { serveAnonymous } from "../../../core/orpc/serve";
import { PlatformModule } from "../platform.module";
import { PlatformManagedWebService } from "../services/platform-managed-web.service";

@Controller()
export class PlatformManagedWebController {
	@Implement(platformContract.getManagedWebState)
	state() {
		return implement(platformContract.getManagedWebState)
			.use(PlatformModule[EffectContextOf])
			.effect(function* ({ context }) {
				const managedWeb = yield* PlatformManagedWebService;
				return yield* serveAnonymous(context)(managedWeb.state());
			});
	}

	@Implement(platformContract.toggleManagedWeb)
	toggle() {
		return implement(platformContract.toggleManagedWeb)
			.use(PlatformModule[EffectContextOf])
			.effect(function* ({ context }) {
				const managedWeb = yield* PlatformManagedWebService;
				const state = yield* serveAnonymous(context)(managedWeb.toggle());
				return { status: 201 as const, body: { state } };
			});
	}

	@Implement(platformContract.restartManagedWeb)
	restart() {
		return implement(platformContract.restartManagedWeb)
			.use(PlatformModule[EffectContextOf])
			.effect(function* ({ context }) {
				const managedWeb = yield* PlatformManagedWebService;
				const state = yield* serveAnonymous(context)(managedWeb.restart());
				return { status: 201 as const, body: { state } };
			});
	}

	@Implement(platformContract.setManagedWebOrigin)
	setOrigin() {
		return implement(platformContract.setManagedWebOrigin)
			.use(PlatformModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const managedWeb = yield* PlatformManagedWebService;
				const state = yield* serveAnonymous(context)(managedWeb.setOrigin(input.origin));
				return { status: 201 as const, body: { state } };
			});
	}

	@Implement(platformContract.enableManagedWebTunnel)
	enableTunnel() {
		return implement(platformContract.enableManagedWebTunnel)
			.use(PlatformModule[EffectContextOf])
			.effect(function* ({ input, context }) {
				const managedWeb = yield* PlatformManagedWebService;
				const state = yield* serveAnonymous(context)(managedWeb.enableTunnel(input.hostname));
				return { status: 201 as const, body: { state } };
			});
	}

	@Implement(platformContract.disableManagedWebTunnel)
	disableTunnel() {
		return implement(platformContract.disableManagedWebTunnel)
			.use(PlatformModule[EffectContextOf])
			.effect(function* ({ context }) {
				const managedWeb = yield* PlatformManagedWebService;
				const state = yield* serveAnonymous(context)(managedWeb.disableTunnel());
				return { status: 201 as const, body: { state } };
			});
	}
}
