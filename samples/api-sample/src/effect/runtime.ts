import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { DiscoveryService } from "@nestjs/core";
import { Context, type Effect, ManagedRuntime } from "effect";
import type { PlanetRepository } from "../modules/planet/repositories/planet.repository";
import type { PlanetService } from "../modules/planet/services/planet.service";
import type { LogStream } from "../modules/stream/services/log-stream.service";
import { collectEffectLayer } from "./effect-layer";

/**
 * Every Effect service key registered in the app. Adding a service means adding
 * it here (one line) so `context['effect/context']` stays typed.
 */
export type AppServices = PlanetRepository | PlanetService | LogStream;

/**
 * Generic bridge between the two DI containers.
 *
 * Builds the app-wide ManagedRuntime once, from the NestJS provider instances
 * whose token is a `Context.Service` key. It knows nothing about features,
 * repositories or modules.
 */
@Injectable()
export class EffectRuntime implements OnApplicationBootstrap, OnApplicationShutdown {
  private runtime?: ManagedRuntime.ManagedRuntime<AppServices, never>;

  constructor(private readonly discovery: DiscoveryService) {}

  onApplicationBootstrap(): void {
    this.runtime = ManagedRuntime.make(collectEffectLayer(this.discovery));
  }

  context(): Promise<Context.Context<AppServices>> {
    if (!this.runtime) {
      throw new Error("EffectRuntime is not initialized yet (onApplicationBootstrap has not run)");
    }
    return this.runtime.context();
  }

  runPromise<A, E>(effect: Effect.Effect<A, E, AppServices>): Promise<A> {
    if (!this.runtime) {
      throw new Error("EffectRuntime is not initialized yet (onApplicationBootstrap has not run)");
    }
    return this.runtime.runPromise(effect);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runtime?.dispose();
  }
}
