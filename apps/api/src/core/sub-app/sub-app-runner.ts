/**
 * SubAppRunner — Creates an independent NestJS HTTP server on its own port,
 * extracts its Express routes, and registers them with the gateway's route
 * registry.
 *
 * Each sub-app is a fully isolated NestJS ApplicationContext with its own:
 *   - Express server on a unique port
 *   - Dependency injection container
 *   - Lifecycle hooks (onModuleInit, onApplicationBootstrap, etc.)
 *
 * After starting, the sub-app's Express router stack is read to discover all
 * registered HTTP routes. These are reported to the RouteRegistryService so
 * the gateway can proxy requests to the correct port.
 *
 * Usage:
 *   const health = await runSubApp({
 *     id: 'health',
 *     module: HealthModule,
 *     port: 3010,
 *     registry: routeRegistry,
 *   });
 *   // health.routes → [{ method: "GET", path: "/health/", subAppId: "health" }]
 */

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';
import express from 'express';
import type { RouteRegistryService } from '../gateway/route-registry.service';
import type { SubAppRegistration } from '../gateway/route.types';
import { extractRoutesFromExpress } from './express-route-extractor';

export interface SubAppOptions {
  /** Unique identifier for this sub-app (used in route entries) */
  id: string;
  /** The NestJS module (or dynamic module) to bootstrap */
  module: Type<any> | DynamicModule | ForwardReference;
  /** The port this sub-app will listen on */
  port: number;
  /** Whether to wait for app.init() before extracting routes (default: true) */
  initBeforeExtract?: boolean;
  /**
   * Optional callback invoked AFTER app.init() but BEFORE route extraction.
   * Use this to register global filters, pipes, guards, interceptors, or
   * to add Express-level middleware/routes to the sub-app's server.
   *
   * The callback receives the NestJS application and the raw Express server.
   */
  afterInit?: (app: INestApplication, server: express.Express) => void | Promise<void>;
}

export interface SubAppResult {
  /** The running NestJS application */
  app: INestApplication;
  /** Registration data extracted from the Express router stack */
  registration: SubAppRegistration;
}

/**
 * Start a sub-app on its own port and extract its routes.
 *
 * @returns The NestJS app instance and its route registration data
 */
export async function runSubApp(
  options: SubAppOptions,
  registry: RouteRegistryService,
): Promise<SubAppResult> {
  const logger = new Logger(`SubAppRunner:${options.id}`);
  logger.log(`Starting sub-app "${options.id}" on port ${options.port}...`);

  // Create a fresh Express instance for this sub-app
  const server = express();
  const adapter = new ExpressAdapter(server);

  // Create a standalone NestJS application
  const app = await NestFactory.create(options.module, adapter, {
    logger: ['log', 'warn', 'error'],
  });

  // Initialize the app (runs onModuleInit, registers all routes on Express)
  if (options.initBeforeExtract !== false) {
    await app.init();
  }

  // Run afterInit callback if provided (global filters, middleware, etc.)
  if (options.afterInit) {
    await options.afterInit(app, server);
  }

  // Extract routes from the Express router stack
  const routes = extractRoutesFromExpress(app, options.id);
  logger.log(`Extracted ${routes.length} routes from sub-app "${options.id}"`);

  // Log the routes for visibility
  for (const route of routes) {
    logger.debug(`  ${route.method} ${route.path}`);
  }

  // Start listening on the assigned port
  await app.listen(options.port, '127.0.0.1');
  logger.log(`Sub-app "${options.id}" listening on http://127.0.0.1:${options.port}`);

  // Build the registration payload
  const registration: SubAppRegistration = {
    id: options.id,
    port: options.port,
    routes,
  };

  // Register with the gateway
  registry.register(registration);
  logger.log(`Sub-app "${options.id}" registered ${routes.length} routes with gateway`);

  return { app, registration };
}

/**
 * Port allocation helper. Keeps track of assigned ports to avoid conflicts.
 */
export class PortAllocator {
  private readonly usedPorts = new Set<number>();
  private nextPort: number;

  /**
   * @param startPort The first port to allocate (default: 3010)
   */
  constructor(startPort = 3010) {
    this.nextPort = startPort;
  }

  /** Allocate the next available port */
  allocate(): number {
    while (this.usedPorts.has(this.nextPort)) {
      this.nextPort++;
    }
    this.usedPorts.add(this.nextPort);
    return this.nextPort;
  }

  /** Release a port when its sub-app shuts down */
  release(port: number): void {
    this.usedPorts.delete(port);
  }

  /** Reset the allocator */
  reset(): void {
    this.usedPorts.clear();
  }
}
