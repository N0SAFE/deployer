/**
 * RouterModule — The root NestJS module for the gateway architecture.
 *
 * This is the ONLY module main.ts imports. It provides:
 *   1. RouterController (@All('*')) — catches all incoming requests and
 *      proxies them to registered sub-apps based on the route graph
 *   2. SubAppCascadeService — starts sub-apps sequentially on their own
 *      internal HTTP ports, extracts their routes, and registers them
 *      with the RouteRegistryService
 *   3. RouteRegistryService — stores the dynamic route graph used by
 *      RouterController to find which sub-app handles a given route
 *
 * The outer gateway Express server (created in main.ts) handles CORS +
 * /health endpoint. Every other request flows through the NestJS
 * RouterController, which acts as the sole API gateway.
 *
 * The gateway does NOT use Postgres. Only the main-app (AppModule)
 * resolves the database connection. The gateway proxies requests to
 * sub-apps which import their own database dependencies.
 */

import { Module } from '@nestjs/common';
import { RouterController } from './router.controller';
import { SubAppCascadeService } from './sub-app-cascade.service';
import { RouteRegistryService } from '../gateway/route-registry.service';
import { EnvModule } from '../../config/env/env.module';

@Module({
  imports: [EnvModule],
  controllers: [RouterController],
  providers: [
    RouteRegistryService,
    SubAppCascadeService,
  ],
  exports: [
    RouteRegistryService,
    SubAppCascadeService,
  ],
})
export class RouterModule {}
