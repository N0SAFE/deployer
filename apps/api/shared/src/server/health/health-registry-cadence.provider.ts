import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { EffectHost } from "@deployer/nest-effect";

import { HealthRegistry } from "./health-registry.service";

/**
 * Owns the registry's background cadence.
 *
 * The registry is an Effect service, so it cannot grow a Nest lifecycle hook: the fork and its interruption belong to
 * one small provider instead. `EffectHost.fork` returns the stop function, so `onModuleDestroy` awaits the fiber and a
 * reload does not leave a timer behind.
 */
@Injectable()
export class HealthRegistryCadence implements OnModuleInit, OnModuleDestroy {
	private stopCadence: (() => Promise<void>) | undefined;

	constructor(
		@Inject(HealthRegistry) private readonly registry: HealthRegistry["Service"],
		@Inject(EffectHost) private readonly host: EffectHost["Service"],
	) {}

	onModuleInit(): void {
		this.stopCadence = this.host.fork("health-registry", this.registry.start());
	}

	async onModuleDestroy(): Promise<void> {
		await this.stopCadence?.();
		await this.host.run(this.registry.stop());
	}
}
