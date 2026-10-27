import { HttpException, Injectable, Logger } from "@nestjs/common";
import { APIError } from "better-auth/api";
import type { Request } from "express";
import { ORPCError } from "@orpc/server";
import { randomUUID } from "node:crypto";
import {
    getInternalErrorRequestContext,
    type InternalErrorRequestContext,
} from "./internal-error-context";
import { MeshBaseDomainError } from "../../modules/mesh/shared/domain/mesh-base-error";

export type InternalErrorInsightModule = {
    readonly id: string;
    supports(error: unknown): boolean;
    describe(error: unknown): Record<string, unknown>;
}

export type InternalErrorCaptureOptions = {
    source: "nest-http" | "orpc" | "better-auth" | "mesh-domain" | "unknown";
    request?: Request;
}

export type InternalErrorCaptureResult = {
    traceId: string;
    requestId?: string;
}

@Injectable()
export class InternalErrorInsightService {
    private readonly logger = new Logger(InternalErrorInsightService.name);
    private readonly modules = new Map<string, InternalErrorInsightModule>();
    private readonly includeStackInLogs = process.env.NODE_ENV !== "production";

    constructor() {
        this.registerModule(this.createOrpcModule());
        this.registerModule(this.createBetterAuthModule());
        this.registerModule(this.createMeshDomainModule());
        this.registerModule(this.createNestHttpModule());
        this.registerModule(this.createFallbackModule());
    }

    registerModule(module: InternalErrorInsightModule): void {
        this.modules.set(module.id, module);
    }

    capture(error: unknown, options: InternalErrorCaptureOptions): InternalErrorCaptureResult {
        const traceId = randomUUID();
        const requestContext = options.request
            ? getInternalErrorRequestContext(options.request)
            : undefined;

        const applicableModules = [...this.modules.values()].filter((module) => module.supports(error));
        const selectedModules = applicableModules.length > 0
            ? applicableModules
            : [this.createFallbackModule()];

        const insightPayload = {
            traceId,
            source: options.source,
            request: this.buildRequestPayload(requestContext),
            error: this.buildBaseErrorPayload(error),
            modules: selectedModules.map((module) => ({
                module: module.id,
                details: module.describe(error),
            })),
        };

        const stack = this.includeStackInLogs && error instanceof Error ? error.stack : undefined;
        this.logger.error(`Captured internal error: ${this.safeStringify(insightPayload)}`, stack);

        return {
            traceId,
            requestId: requestContext?.requestId,
        };
    }

    shouldExposeDebugPayload(): boolean {
        return this.includeStackInLogs;
    }

    buildClientDebugPayload(error: unknown): Record<string, unknown> {
        return {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : "Unknown error",
            stack: this.includeStackInLogs && error instanceof Error ? error.stack : undefined,
        };
    }

    private buildRequestPayload(context: InternalErrorRequestContext | undefined): Record<string, unknown> | undefined {
        if (!context) {
            return undefined;
        }

        return {
            requestId: context.requestId,
            method: context.method,
            path: context.path,
            ip: context.ip,
            userAgent: context.userAgent,
        };
    }

    private buildBaseErrorPayload(error: unknown): Record<string, unknown> {
        if (error instanceof Error) {
            return {
                name: error.name,
                message: error.message,
            };
        }

        return {
            name: "NonErrorThrownValue",
            value: this.safeStringify(error),
        };
    }

    private safeStringify(value: unknown): string {
        try {
            return JSON.stringify(value);
        } catch {
            return "[unserializable]";
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }

    private getStringProperty(value: unknown, key: string): string | undefined {
        if (!this.isRecord(value)) {
            return undefined;
        }

        const property = value[key];
        return typeof property === "string" ? property : undefined;
    }

    private getNumberProperty(value: unknown, key: string): number | undefined {
        if (!this.isRecord(value)) {
            return undefined;
        }

        const property = value[key];
        return typeof property === "number" ? property : undefined;
    }

    private getUnknownProperty(value: unknown, key: string): unknown {
        if (!this.isRecord(value)) {
            return undefined;
        }

        return value[key];
    }

    private createOrpcModule(): InternalErrorInsightModule {
        return {
            id: "orpc",
            supports: (error: unknown) => {
                if (error instanceof ORPCError) {
                    return true;
                }

                if (!this.isRecord(error)) {
                    return false;
                }

                return this.getStringProperty(error, "code") !== undefined
                    && this.getNumberProperty(error, "status") !== undefined;
            },
            describe: (error: unknown) => {
                const code = this.getStringProperty(error, "code");
                const status = this.getNumberProperty(error, "status");
                const message = this.getStringProperty(error, "message");
                const cause = this.getUnknownProperty(error, "cause");

                return {
                    code,
                    status,
                    message,
                    causeName: cause instanceof Error ? cause.name : undefined,
                };
            },
        };
    }

    private createBetterAuthModule(): InternalErrorInsightModule {
        return {
            id: "better-auth",
            supports: (error: unknown) => error instanceof APIError,
            describe: (error: unknown) => {
                const apiError = error as APIError;

                return {
                    statusCode: apiError.statusCode,
                    message: apiError.body?.message,
                    body: apiError.body,
                };
            },
        };
    }

    private createMeshDomainModule(): InternalErrorInsightModule {
        // ── WHY THIS IS NOW A STATIC IMPORT ─────────────────────────────────────
        // It used to be a lazy `require("../../modules/mesh/shared/domain/mesh-base-error")`,
        // justified in a comment by a circular-import risk. Two things were wrong with
        // that, and both cost a real outage:
        //
        //  1. The path was ALIASED. Aliases — vitest's `resolve.alias` and tsconfig
        //     `paths` alike — are applied by the TRANSFORMER to `import` specifiers
        //     only. A `require("…")` argument is a runtime string nothing rewrites, so
        //     `@/core/…` was handed to Node verbatim. It worked only while `@/core`
        //     meant `./src/core`; when `src/core` moved to `shared/src/core` the app
        //     stopped compiling with `Cannot find module '../../modules/mesh/…'`.
        //
        //  2. The cycle it avoided does not exist. `mesh-base-error.ts` has ZERO
        //     imports — it is a self-contained `Error` subclass. A static import of it
        //     cannot close a cycle, because there is no edge back to this file. (The
        //     cycle the comment described is between the FILTER and the mesh module;
        //     this file only ever needed the base error CLASS.)
        //
        // A static import is therefore both correct and strictly more robust: it is
        // resolved at build time, type-checked, and renamed/relocated by tooling.
        return {
            id: "mesh-domain",
            supports: (error: unknown) => error instanceof MeshBaseDomainError,
            describe: (error: unknown) => {
                if (error instanceof MeshBaseDomainError) {
                    return {
                        code: error.code,
                        httpStatus: error.httpStatus,
                        orpcCode: error.orpcCode,
                        message: error.message,
                    };
                }
                return {};
            },
        };
    }

    private createNestHttpModule(): InternalErrorInsightModule {
        return {
            id: "nest-http",
            supports: (error: unknown) => error instanceof HttpException,
            describe: (error: unknown) => {
                const httpException = error as HttpException;

                return {
                    status: httpException.getStatus(),
                    response: httpException.getResponse(),
                };
            },
        };
    }

    private createFallbackModule(): InternalErrorInsightModule {
        return {
            id: "fallback",
            supports: () => true,
            describe: (error: unknown) => {
                if (error instanceof Error) {
                    return {
                        name: error.name,
                        message: error.message,
                    };
                }

                return {
                    value: this.safeStringify(error),
                };
            },
        };
    }
}
