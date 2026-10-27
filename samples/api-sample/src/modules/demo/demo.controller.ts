import { Controller } from "@nestjs/common";
import { trace } from "@opentelemetry/api";
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { catchORPCErrorCode, createEffectClient } from "@orpc/effect";
import { OpenAPILink } from "@orpc/openapi/fetch";
import { implement } from "@orpc/server";
import { Effect } from "effect";
import { contract } from "../../contracts";
import { demoContract } from "../../contracts/demo.contract";
import { Implement } from "@orpc/nest";
import { requireSession } from "../../orpc/require-session";

@Controller()
export class DemoController {
  /**
   * Effect client calls, server-side: the handler calls its own OpenAPI
   * endpoint through `OpenAPILink`, wrapped by `createEffectClient`, and
   * recovers a typed `NOT_FOUND` without try/catch.
   */
  @Implement(demoContract.report)
  report() {
    return implement(demoContract.report)
      .use(requireSession)
      .effect(function* ({ input, context }) {
        const origin = `${context.request.protocol}://${context.request.get("host")}`;

        const client = createEffectClient(
          createORPCClient<ContractRouterClient<typeof contract>>(
            new OpenAPILink(contract, {
              origin,
              // Request Headers Plugin: forward the session cookie so the
              // loopback call is authenticated.
              headers: { cookie: context.reqHeaders?.get("cookie") ?? "" },
            }),
          ),
        );

        const planets = yield* client.planet.list({ limit: 100 });

        // Recover a typed NOT_FOUND without try/catch; `null` is the
        // fallback, so the success type stays a Planet.
        const missing = yield* client.planet.findById({ id: input.missingId }).pipe(
          catchORPCErrorCode("NOT_FOUND", () => Effect.succeed(null)),
        );

        return {
          total: planets.length,
          recovered: missing?.name ?? `unknown:${input.missingId}`,
          traceId: trace.getActiveSpan()?.spanContext().traceId ?? null,
        };
      });
  }
}
