import type { Request, Response } from "express";
import { Logger } from "@nestjs/common";
import type { Mock } from "vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoggerMiddleware } from "./logger.middleware";

/**
 * `os.hostname()` runs on every request, so its real value would make the
 * assertion depend on the machine. Mocked at module scope: `vi.mock` is hoisted,
 * so placing it inside a test body (as this file's predecessor did) only LOOKED
 * scoped while applying to the whole file.
 */
vi.mock("os", () => ({ hostname: () => "test-hostname" }));

/**
 * The middleware writes through Nest's `Logger`, which discards output below the
 * active level. Spying on the prototype asserts the LOG CALL — the actual
 * contract — instead of coupling the test to the logger's output format.
 *
 * Spied ONCE at module scope and only CLEARED between tests. `restoreAllMocks()`
 * would undo the spy after the first test, so every later assertion saw a real
 * (level-filtered, silent) logger and failed with "called 0 times".
 */
const debugSpy = vi
    .spyOn(Logger.prototype, "debug")
    .mockImplementation(() => undefined);
const warnSpy = vi
    .spyOn(Logger.prototype, "warn")
    .mockImplementation(() => undefined);
const errorSpy = vi
    .spyOn(Logger.prototype, "error")
    .mockImplementation(() => undefined);

describe("LoggerMiddleware", () => {
    let middleware: LoggerMiddleware;
    let next: Mock<() => void>;
    let mockRequest: Partial<Request>;
    let mockResponse: Partial<Response>;
    /** Fires the "close" listener the middleware registered. */
    let fireClose: () => void;

    beforeEach(() => {
        middleware = new LoggerMiddleware();
        next = vi.fn<() => void>();
        vi.clearAllMocks();

        let onClose: (() => void) | undefined;

        mockRequest = {
            ip: "127.0.0.1",
            method: "GET",
            originalUrl: "/api/health",
            get: vi.fn((header: string) => {
                if (header === "user-agent") return "test-agent";
                if (header === "referer") return "http://example.com";
                return undefined;
            }) as unknown as Request["get"],
        };

        mockResponse = {
            statusCode: 200,
            statusMessage: "OK",
            get: vi.fn().mockReturnValue("1024") as unknown as Response["get"],
            on: vi.fn((event: string, callback: () => void) => {
                if (event === "close") onClose = callback;
                return mockResponse as Response;
            }) as unknown as Response["on"],
        };

        fireClose = () => {
            onClose?.();
        };
    });

    /** One call site for the cast, so the mocks stay `Partial<>` literals. */
    function run(): void {
        middleware.use(mockRequest as Request, mockResponse as Response, next);
    }

    it("calls next immediately, without waiting for the response", () => {
        run();

        expect(next).toHaveBeenCalledOnce();
    });

    it("registers a close listener on the response", () => {
        run();

        expect(mockResponse.on).toHaveBeenCalledWith(
            "close",
            expect.any(Function),
        );
    });

    it("reads the user-agent and referer headers", () => {
        run();

        expect(mockRequest.get).toHaveBeenCalledWith("user-agent");
        expect(mockRequest.get).toHaveBeenCalledWith("referer");
    });

    it("tolerates a request with no user-agent or referer", () => {
        mockRequest.get = vi
            .fn()
            .mockReturnValue(undefined) as unknown as Request["get"];

        expect(() => {
            run();
        }).not.toThrow();
        expect(next).toHaveBeenCalledOnce();
    });

    it("logs only once the response closes", () => {
        run();
        expect(debugSpy).not.toHaveBeenCalled();

        fireClose();

        expect(debugSpy).toHaveBeenCalledOnce();
    });

    it("logs a 4xx at warn and a 5xx at error", () => {
        mockResponse.statusCode = 404;
        run();
        fireClose();
        expect(warnSpy).toHaveBeenCalledOnce();

        mockResponse.statusCode = 503;
        run();
        fireClose();
        expect(errorSpy).toHaveBeenCalledOnce();
    });

    it("does not log a safelisted path", () => {
        mockRequest.originalUrl = "/health";

        run();
        fireClose();

        expect(debugSpy).not.toHaveBeenCalled();
    });

    it("logs when content-length is absent", () => {
        mockResponse.get = vi
            .fn()
            .mockReturnValue(undefined) as unknown as Response["get"];

        run();

        expect(() => {
            fireClose();
        }).not.toThrow();
        expect(debugSpy).toHaveBeenCalledOnce();
    });

    it("never ends the response, so streaming is not interrupted", () => {
        // Not covered before, and it is the reason this middleware has its
        // current shape: calling `res.end()` on close breaks SSE / HTTP-2
        // responses with ERR_HTTP2_PROTOCOL_ERROR.
        const end = vi.fn();
        mockResponse.end = end as unknown as Response["end"];

        run();
        fireClose();

        expect(end).not.toHaveBeenCalled();
    });
});
