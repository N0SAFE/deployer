import "@orpc/effect/extensions/effect";

import { Module, type ExecutionContext } from "@nestjs/common";
import { ORPCModule } from "@orpc/nest";
import { ORPCError, onError } from "@orpc/server";
import {
  RequestHeadersHandlerPlugin,
  ResponseHeadersHandlerPlugin,
  RethrowHandlerPlugin,
} from "@orpc/server/plugins";
import type { Request } from "express";
import { auth } from "./auth/auth";
import { toAuthContext } from "./auth/auth-context";
import { AuthModule } from "./auth/auth.module";
import { EffectRuntime } from "./effect/runtime";
import { EffectRuntimeModule } from "./effect/runtime.module";
import { AuthFeatureModule } from "./modules/auth/auth.module";
import { DemoModule } from "./modules/demo/demo.module";
import { DocsModule } from "./modules/docs/docs.module";
import { PlanetModule } from "./modules/planet/planet.module";
import { StreamModule } from "./modules/stream/stream.module";
import type { AppContext } from "./orpc/context";
import { RxJSHandlerPlugin } from "./orpc/rxjs-handler.plugin";

@Module({
  imports: [
    // Must be first: registers the Better Auth handler and the session
    // middleware before any route exists.
    AuthModule.forRoot({ auth }),

    /**
     * `forRootAsync` is where the two containers meet: NestJS injects the
     * singleton EffectRuntime (auto-discovering Effect service providers),
     * and each request receives its cached Effect context. Nothing is built
     * per request.
     */
    ORPCModule.forRootAsync({
      imports: [EffectRuntimeModule],
      inject: [EffectRuntime],
      useFactory: (runtime: EffectRuntime) => ({
        context: async (executionContext: ExecutionContext): Promise<AppContext> => {
          const request = executionContext.switchToHttp().getRequest<Request>();

          return {
            request,
            // Resolved once by SessionMiddleware, not here.
            auth: toAuthContext(request.session ?? null),
            "effect/context": await runtime.context(),
          };
        },

        /** Header plugins + oRPC's native RxJS transport. */
        plugins: [
          new RequestHeadersHandlerPlugin(),
          new ResponseHeadersHandlerPlugin(),
          new RethrowHandlerPlugin({ filter: (error) => !(error instanceof ORPCError) }),
          new RxJSHandlerPlugin(),
        ],

        interceptors: [
          onError((error) => {
            // Typed ORPC errors are part of the contract, not incidents.
            if (!(error instanceof ORPCError)) console.error("[orpc] unexpected", error);
          }),
        ],

        /** SSE: flush headers immediately and ping while the generator is idle. */
        toNestResponse: {
          eventStream: {
            initialComment: { enabled: true, comment: "stream open" },
            keepAlive: { enabled: true, interval: 5_000, comment: "ping" },
          },
        },
      }),
    }),

    PlanetModule,
    AuthFeatureModule,
    StreamModule,
    DemoModule,
    DocsModule,
  ],
})
export class AppModule {}
