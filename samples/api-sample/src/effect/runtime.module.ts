import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { EffectRuntime } from "./runtime";

/**
 * Zero-configuration Effect runtime. Imported only by the oRPC module (its one
 * consumer); feature modules never import it and never wire Layers.
 */
@Module({
  imports: [DiscoveryModule],
  providers: [EffectRuntime],
  exports: [EffectRuntime],
})
export class EffectRuntimeModule {}
