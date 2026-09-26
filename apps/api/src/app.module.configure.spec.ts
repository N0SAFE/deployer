import type { MiddlewareConsumer, Type } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { AppModule } from "@/app.module";
import { LoggerMiddleware } from "./core/middlewares/logger.middleware";
import { InternalErrorContextMiddleware } from "./core/middlewares/internal-error/internal-error-context.middleware";

/**
 * `AppModule.configure()` wires the global middleware chain.
 *
 * Asserted WITHOUT building a container. `AppModule` declares no constructor
 * dependencies, so `new AppModule()` is the instance `moduleRef.get(AppModule)`
 * would return, minus the cost of assembling the whole graph — which
 * `app.graph.spec.ts` already covers and which would make this test fail for
 * reasons that have nothing to do with `configure()`.
 *
 * The consumer is mocked rather than driven through a live request: this is a
 * WIRING test (are the right middlewares applied, in the right order, to the
 * right routes). A real request would additionally exercise the middleware
 * bodies, which have their own specs.
 *
 * The mock mirrors Nest's two-step chain — `apply()` returns the config proxy,
 * whose `exclude()`/`forRoutes()` return for chaining — so it must be typed
 * against BOTH interfaces, not just `MiddlewareConsumer` (`forRoutes` lives on
 * the proxy).
 */
interface MiddlewareConfigProxyMock {
    exclude: ReturnType<typeof vi.fn>;
    forRoutes: ReturnType<typeof vi.fn>;
}

function createConsumer(): {
    consumer: MiddlewareConsumer;
    proxy: MiddlewareConfigProxyMock;
} {
    const proxy: MiddlewareConfigProxyMock = {
        exclude: vi.fn(),
        forRoutes: vi.fn(),
    };
    proxy.exclude.mockReturnValue(proxy);
    proxy.forRoutes.mockReturnValue({ apply: vi.fn() });

    const apply = vi.fn().mockReturnValue(proxy);

    return {
        consumer: { apply } as unknown as MiddlewareConsumer,
        proxy,
    };
}

describe("AppModule (middleware wiring)", () => {
    it("applies the internal-error context and logger middlewares to every route", () => {
        const { consumer, proxy } = createConsumer();

        new AppModule().configure(consumer);

        expect(consumer.apply).toHaveBeenCalledWith(
            InternalErrorContextMiddleware,
            LoggerMiddleware,
        );
        expect(proxy.forRoutes).toHaveBeenCalledWith("*");
    });

    it("applies the internal-error context middleware FIRST", () => {
        const { consumer } = createConsumer();

        new AppModule().configure(consumer);

        // Order is a contract, not a detail: the context middleware establishes
        // the request-scoped error context that `LoggerMiddleware` and the
        // exception filters read. Reversed, every log line loses its correlation
        // id — and the failure is silent.
        const applied = vi.mocked(consumer.apply).mock
            .calls[0] as [Type<unknown>, ...Type<unknown>[]];
        expect(applied[0]).toBe(InternalErrorContextMiddleware);
    });
});
