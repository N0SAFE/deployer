/**
 * SubAppCascadeService — Starts sub-apps sequentially in a defined order.
 *
 * Each sub-app is a fully independent NestJS HTTP application on its own
 * internal port. The cascade ensures that sub-apps start in order (e.g.,
 * health → auth → mesh → main-app), so dependencies are available before
 * consumers start.
 *
 * After each sub-app starts, its Express routes are extracted and registered
 * with the RouteRegistryService. The gateway can then proxy requests to
 * the newly available sub-app.
 *
 * The last sub-app in the cascade is the "main-app" (AppModule) which
 * receives the registrations from all previous sub-apps.
 */

import { Injectable, Logger, type INestApplication, type OnApplicationBootstrap } from '@nestjs/common';
import { RouteRegistryService } from '../gateway/route-registry.service';
import { runSubApp, type SubAppOptions, PortAllocator } from '../sub-app/sub-app-runner';
import type { SubAppRegistration } from '../gateway/route.types';

/** Describes a sub-app to be started by the cascade */
export interface SubAppDefinition {
  /** Unique identifier (used for route entries and logging) */
  id: string;
  /** The NestJS module to bootstrap */
  module: SubAppOptions['module'];
  /** Optionally override the auto-allocated port */
  portOverride?: number;
  /** Options passed to runSubApp */
  options?: Partial<Omit<SubAppOptions, 'id' | 'module' | 'port'>>;
}

/** Result of a started sub-app */
export interface SubAppCascadeResult {
  id: string;
  port: number;
  registration: SubAppRegistration;
}

@Injectable()
export class SubAppCascadeService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SubAppCascadeService.name);
  private readonly portAllocator = new PortAllocator(3010);

  /** Ordered list of sub-apps to start */
  private readonly subApps: SubAppDefinition[] = [];

  /** Results from started sub-apps (ordered) */
  private readonly results: SubAppCascadeResult[] = [];

  /** Map of sub-app id → NestJS application instance */
  private readonly appMap = new Map<string, INestApplication>();

  constructor(
    private readonly registry: RouteRegistryService,
  ) {}

  /**
   * Get the NestJS application instance for a sub-app by id.
   * Returns undefined if the sub-app hasn't been started yet.
   */
  getApp(id: string): INestApplication | undefined {
    return this.appMap.get(id);
  }

  /**
   * Register a sub-app to be started during the cascade.
   * Sub-apps are started in the order they are registered.
   */
  register(def: SubAppDefinition): this {
    this.subApps.push(def);
    return this;
  }

  /** Get results from all started sub-apps */
  getResults(): readonly SubAppCascadeResult[] {
    return this.results;
  }

  /** Get the last sub-app result (the "main app") */
  getLastResult(): SubAppCascadeResult | undefined {
    return this.results.length > 0 ? this.results[this.results.length - 1] : undefined;
  }

  /**
   * Start all registered sub-apps sequentially.
   * Each sub-app must complete (init + route extraction + registration)
   * before the next starts.
   */
  async startAll(): Promise<SubAppCascadeResult[]> {
    this.results.length = 0;

    for (const def of this.subApps) {
      try {
        const result = await this.startOne(def);
        this.results.push(result);
      } catch (err) {
        this.logger.error(
          `Sub-app "${def.id}" failed to start: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    }

    // Set the fallback target to the last sub-app (the "main-app")
    // This ensures requests for middleware-registered routes (e.g. BetterAuth)
    // that aren't visible to the Express route extractor are still proxied.
    const lastResult = this.results.length > 0
      ? this.results[this.results.length - 1]
      : null;
    if (lastResult) {
      this.registry.setFallback({
        targetUrl: `http://127.0.0.1:${String(lastResult.port)}/`,
        subAppId: lastResult.id,
      });
    }

    const routeCount = this.results.reduce(
      (sum, r) => sum + r.registration.routes.length,
      0,
    );
    this.logger.log(
      `Cascade complete — ${this.results.length} sub-app(s) started, ` +
        `${routeCount} route(s) registered`,
    );

    return this.results;
  }

  /** Start a single sub-app and register its routes */
  private async startOne(def: SubAppDefinition): Promise<SubAppCascadeResult> {
    const port = def.portOverride ?? this.portAllocator.allocate();
    const id = def.id;

    this.logger.log(`Starting sub-app "${id}" on port ${port}...`);

    const { app, registration } = await runSubApp(
      {
        id,
        module: def.module,
        port,
        initBeforeExtract: def.options?.initBeforeExtract ?? true,
        afterInit: def.options?.afterInit,
      },
      this.registry,
    );

    // Store the app reference so main.ts can access its services
    this.appMap.set(id, app);

    this.logger.log(
      `Sub-app "${id}" running on http://127.0.0.1:${port} ` +
        `with ${registration.routes.length} route(s)`,
    );

    return { id, port, registration };
  }

  /** Implement OnApplicationBootstrap to auto-start cascade */
  async onApplicationBootstrap(): Promise<void> {
    if (this.subApps.length > 0) {
      await this.startAll();
    }
  }
}
