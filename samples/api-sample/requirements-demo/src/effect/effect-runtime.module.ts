import { Module } from "@nestjs/common";

import { EffectRuntime } from "./effect-runtime";

/** The Effect runtime, imported once by the composition root. Feature modules never import it. */
@Module({
	providers: [EffectRuntime],
	exports: [EffectRuntime],
})
export class EffectRuntimeModule {}
