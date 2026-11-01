import { Effect } from "effect";

import { createModuleContext } from "../effect-graph";
import { HealthRegistry } from "./health.service";

/**
 * A leaf that owns the registry token.
 *
 * The module is the only place that mentions the provider. Anything whose layer
 * requires `HealthRegistry` imports this module; nothing else lists it.
 */
export class HealthRegistryModule extends createModuleContext({
	name: "HealthRegistryModule",
	providers: [
		{
			provide: HealthRegistry,
			useValue: {
				runOnce: () =>
					Effect.succeed({ status: "up" as const, checkedAt: "2026-10-29T00:00:00Z" }),
			},
		},
	],
}) {}
