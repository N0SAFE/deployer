import { Module } from "@nestjs/common";

import { declareModule } from "../src/effect";
import { MeshClock } from "../src/modules/platform/services/mesh-clock.service";

@Module({
	providers: [{ provide: MeshClock, useValue: MeshClock.live }],
	exports: [MeshClock],
})
class DeclaredNestModule {}

/** CLEAN: the same plain module as `legacy.module.ts`, annotated with `declareModule`. No finding. */
export const DeclaredModule = declareModule(DeclaredNestModule, { provides: [MeshClock] });
