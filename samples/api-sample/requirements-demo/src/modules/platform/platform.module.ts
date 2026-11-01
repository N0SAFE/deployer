import { Module } from "@nestjs/common";

import { declareModule, UnmetOf } from "../../effect";

import { LeaseSigner } from "./services/lease-signer.service";
import { MeshClock } from "./services/mesh-clock.service";

/**
 * A plain Nest module, exactly as it is: `@Module`, providers under their Effect tags, exports.
 *
 * Nothing here knows about requirements. That is the point — it is the kind of module a shared package ships, and it
 * does not have to be rewritten to join the flow.
 */
@Module({
	providers: [
		{ provide: MeshClock, useValue: MeshClock.live },
		{ provide: LeaseSigner, useValue: LeaseSigner.live },
	],
	exports: [MeshClock, LeaseSigner],
})
class PlatformNestModule {}

/**
 * The same module, annotated.
 *
 * `declareModule` is type-only: `provides` is what it contributes to the Effect context, `exports` what it hands to its
 * importers. `global: true` marks it like Nest's `@Global()`: its exports are visible everywhere, imported or not.
 */
export const PlatformModule = declareModule(PlatformNestModule, {
	provides: [MeshClock, LeaseSigner],
	global: true,
});

/** Empty: it declares no requirement of its own. */
export type PlatformRequirements = UnmetOf<typeof PlatformModule>;
