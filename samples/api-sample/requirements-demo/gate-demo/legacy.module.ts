import { Module } from "@nestjs/common";

import { MeshClock } from "../src/modules/platform/services/mesh-clock.service";

/**
 * VIOLATION `deployer-effect/requireModuleContext`: a bare `@Module`. It carries no `ExportsOf`, so importing it
 * contributes `never` to the type flow and its services are invisible.
 */
@Module({
	providers: [{ provide: MeshClock, useValue: MeshClock.live }],
	exports: [MeshClock],
})
export class LegacyModule {}
