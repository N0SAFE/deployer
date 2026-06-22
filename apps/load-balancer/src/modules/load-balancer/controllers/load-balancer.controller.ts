import {
    All,
    BadRequestException,
    Body,
    Controller,
    Get,
    Headers as HttpHeader,
    HttpCode,
    Param,
    Post,
    Query,
    Req,
    Res,
    ServiceUnavailableException,
    UnauthorizedException,
} from "@nestjs/common";
import type { Request as ExpressRequest, Response as ExpressResponse } from "express";
import { LoadBalancerService } from "../services/load-balancer.service";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { LoadBalancerReconnectSignal, MeshLoadReport } from "../types/load-balancer.types";
import { ApiSessionAuthService } from "../../../core/modules/auth/services/api-session-auth.service";
import { EnvService } from "../../../config/env/env.service";

@Controller()
export class LoadBalancerController {
    constructor(
        private readonly loadBalancerService: LoadBalancerService,
        private readonly apiSessionAuthService: ApiSessionAuthService,
        private readonly envService: EnvService,
    ) {}

    private ensureMeshInternalKey(incoming: string | undefined): void {
        const expected = this.envService.get("MESH_STREAM_SHARED_SECRET")?.trim();

        if (!expected) {
            return;
        }

        if (!incoming || incoming !== expected) {
            throw new UnauthorizedException("Invalid mesh internal key");
        }
    }

    private parseCookieToken(cookieHeader: string | undefined, cookieName: string): string | null {
        if (!cookieHeader) {
            return null;
        }

        const chunks = cookieHeader.split(";");
        for (const chunk of chunks) {
            const [rawName, ...rest] = chunk.trim().split("=");
            if (rawName !== cookieName) {
                continue;
            }

            const value = rest.join("=").trim();
            return value.length > 0 ? decodeURIComponent(value) : null;
        }

        return null;
    }

    private localNodeId(): string {
        const nodeId = this.envService.get("MESH_NODE_ID")?.trim();
        return nodeId ?? `lb-${String(process.pid)}`;
    }

    private localUpstreamUrl(): string | null {
        const explicit = this.envService.get("LB_LOCAL_UPSTREAM_URL")?.trim();
        if (explicit) {
            return explicit;
        }

        const apiUrl = this.envService.get("API_URL")?.trim();
        return apiUrl || null;
    }

    private toCandidateUpstream(candidate: { nodeId: string; serverUrl: string }): string {
        if (candidate.nodeId === this.localNodeId()) {
            return this.localUpstreamUrl() ?? candidate.serverUrl;
        }

        return candidate.serverUrl;
    }

    private parseDiagnosticPathPrefix(path: string): boolean {
        const fingerprint = (this.envService.get("LB_DIAGNOSTIC_PATH_FINGERPRINT") ?? "__lb_diag").trim();
        const normalized = path.startsWith("/") ? path : `/${path}`;
        const prefix = `/${fingerprint}`;

        return normalized === prefix || normalized.startsWith(`${prefix}/`);
    }

    private verifyDiagnosticKey(key: string | undefined): boolean {
        if (!key) {
            return false;
        }

        const secret = this.envService.get("LB_DIAGNOSTIC_SECRET")?.trim();
        if (!secret) {
            return false;
        }

        const [version, timestampRaw, signature] = key.split(".");
        if (version !== "v1" || !timestampRaw || !signature) {
            return false;
        }

        const timestamp = Number(timestampRaw);
        if (!Number.isFinite(timestamp)) {
            return false;
        }

        const now = Math.floor(Date.now() / 1000);
        if (Math.abs(now - timestamp) > 30) {
            return false;
        }

        const unsigned = `${version}.${timestampRaw}`;
        const expected = createHmac("sha256", secret).update(unsigned).digest("base64url");

        const left = Buffer.from(signature);
        const right = Buffer.from(expected);
        if (left.length !== right.length) {
            return false;
        }

        return timingSafeEqual(left, right);
    }

    private async getAuthenticatedSession(input: {
        authorizationHeader?: string;
        cookieHeader?: string;
    }): Promise<{ userId: string; activeOrganizationId: string | null }> {
        const session = await this.apiSessionAuthService.getSessionFromRequestHeaders({
            cookie: input.cookieHeader,
            authorization: input.authorizationHeader,
        });

        if (!session?.user.id) {
            throw new UnauthorizedException("Authentication is required for diagnostics");
        }

        return {
            userId: session.user.id,
            // Active organization is no longer stored on the session; require explicit organizationId.
            activeOrganizationId: null,
        };
    }

    private buildUpstreamHeaders(input: {
        cookieHeader?: string;
        authorizationHeader?: string;
        routeToken?: string | null;
        requestHeaders?: Record<string, string | string[] | undefined>;
        requestAccept?: string;
    }): globalThis.Headers {
        const headers = new globalThis.Headers({
            accept: input.requestAccept ?? "text/event-stream",
            "cache-control": "no-cache",
        });

        if (input.requestHeaders) {
            for (const [name, rawValue] of Object.entries(input.requestHeaders)) {
                const lower = name.toLowerCase();
                if (
                    lower === "host" ||
                    lower === "connection" ||
                    lower === "content-length" ||
                    lower === "x-lb-route-token" ||
                    lower === "x-mesh-internal-key"
                ) {
                    continue;
                }

                if (Array.isArray(rawValue)) {
                    headers.set(name, rawValue.join(", "));
                } else if (typeof rawValue === "string") {
                    headers.set(name, rawValue);
                }
            }
        }

        if (input.cookieHeader) {
            headers.set("cookie", input.cookieHeader);
        }
        if (input.authorizationHeader) {
            headers.set("authorization", input.authorizationHeader);
        }
        if (input.routeToken) {
            headers.set("x-lb-route-token", input.routeToken);
        }

        const meshInternalKey = this.envService.get("MESH_STREAM_SHARED_SECRET")?.trim();
        if (meshInternalKey) {
            headers.set("x-mesh-internal-key", meshInternalKey);
        }

        return headers;
    }

    private async resolveOrganizationId(input: {
        organizationId?: string;
        authorizationHeader?: string;
        cookieHeader?: string;
        meshInternalKey?: string;
    }): Promise<string> {
        const expectedInternalKey = this.envService.get("MESH_STREAM_SHARED_SECRET")?.trim();
        const isInternal =
            !!expectedInternalKey &&
            !!input.meshInternalKey &&
            input.meshInternalKey === expectedInternalKey;

        let resolvedOrganizationId = input.organizationId;

        if (isInternal) {
            if (!resolvedOrganizationId) {
                throw new BadRequestException("organizationId is required for internal routed requests");
            }
            return resolvedOrganizationId;
        }

        const session = await this.apiSessionAuthService.getSessionFromRequestHeaders({
            cookie: input.cookieHeader,
            authorization: input.authorizationHeader,
        });

        if (!session?.user.id) {
            throw new UnauthorizedException("Authentication is required for load-balanced requests");
        }

        // Active organization is no longer available on the session; callers must provide organizationId.
        if (!resolvedOrganizationId) {
            throw new BadRequestException("organizationId query parameter is required for load-balanced requests");
        }

        return resolvedOrganizationId;
    }

    private buildProxiedPath(targetPath: string): string {
        const sanitized = targetPath.trim();
        if (!sanitized || sanitized === "/") {
            return "/";
        }
        return sanitized.startsWith("/") ? sanitized : `/${sanitized}`;
    }

    private getRequestBody(req: ExpressRequest): string | Buffer | Uint8Array | undefined {
        const method = req.method.toUpperCase();
        if (method === "GET" || method === "HEAD") {
            return undefined;
        }

        const body = req.body as unknown;
        if (body === undefined || body === null) {
            return undefined;
        }

        if (typeof body === "string" || body instanceof Uint8Array || body instanceof Buffer) {
            return body;
        }

        if (typeof body === "object") {
            return JSON.stringify(body);
        }

        return undefined;
    }

    private applyUpstreamResponseHeaders(
        res: ExpressResponse,
        upstreamHeaders: globalThis.Headers,
        includeStreamingHeaders = false,
    ): void {
        upstreamHeaders.forEach((value, key) => {
            const lower = key.toLowerCase();
            if (lower === "transfer-encoding" || lower === "connection") {
                return;
            }
            if (!includeStreamingHeaders && lower === "content-length") {
                return;
            }
            res.setHeader(key, value);
        });
    }

    private writeReconnectSignal(res: ExpressResponse, signal: LoadBalancerReconnectSignal): void {
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.setHeader("X-LB-Reconnect-Signal", "1");
        res.status(200);
        res.flushHeaders();
        res.write(`event: ${signal.type}\\ndata: ${JSON.stringify(signal)}\\n\\n`);
        res.end();
    }

    @Post("/internal/mesh/load-report")
    @HttpCode(202)
    reportMeshLoad(
        @Body() body: MeshLoadReport,
        @HttpHeader("x-mesh-internal-key") meshInternalKey: string | undefined,
    ) {
        this.ensureMeshInternalKey(meshInternalKey);

        if (!body?.nodeId || !body?.serverUrl || !body?.organizationId || !body?.metrics) {
            throw new BadRequestException("Missing required report fields");
        }

        const ingest = this.loadBalancerService.ingestLoadReport(body);
        return {
            accepted: ingest.accepted,
            nodeId: body.nodeId,
            reportId: ingest.reportId,
            propagated: ingest.propagated,
            deduplicated: ingest.deduplicated,
            hopCount: ingest.hopCount,
            reportedAt: new Date().toISOString(),
        };
    }

    @Get("/internal/mesh/load-report/convergence")
    getLoadReportConvergence(
        @Query("organizationId") organizationId: string | undefined,
        @HttpHeader("x-mesh-internal-key") meshInternalKey: string | undefined,
    ) {
        this.ensureMeshInternalKey(meshInternalKey);
        return this.loadBalancerService.getLoadReportConvergence(organizationId);
    }

    @Post("/internal/routes/resolve")
    async resolveRoute(
        @Body() body: { organizationId: string; streamKey: string },
        @HttpHeader("x-lb-route-token") tokenHeader: string | undefined,
        @HttpHeader("x-mesh-internal-key") meshInternalKey: string | undefined,
    ) {
        this.ensureMeshInternalKey(meshInternalKey);

        await this.loadBalancerService.refreshRouteSecretsFromControlPlane();

        if (!body?.organizationId || !body?.streamKey) {
            throw new BadRequestException("organizationId and streamKey are required");
        }

        const resolved = this.loadBalancerService.resolveRoute({
            organizationId: body.organizationId,
            streamKey: body.streamKey,
            hintToken: tokenHeader,
        });

        if (!resolved.selected) {
            throw new ServiceUnavailableException("No healthy node available for this organization");
        }

        return {
            selected: resolved.selected,
            candidates: resolved.candidates,
            routeHintToken: resolved.routeHintToken,
            fallbackUsed: resolved.fallbackUsed,
        };
    }

    @Get("/stream/:streamKey")
    async routeStream(
        @Param("streamKey") streamKey: string,
        @Query("organizationId") organizationId: string | undefined,
        @Query("targetPath") targetPath: string | undefined,
        @Query("replay") replay: string | undefined,
        @Query("replayLimit") replayLimit: string | undefined,
        @HttpHeader("x-lb-route-token") tokenHeader: string | undefined,
        @HttpHeader("authorization") authorizationHeader: string | undefined,
        @HttpHeader("x-mesh-internal-key") meshInternalKey: string | undefined,
        @HttpHeader("cookie") cookieHeader: string | undefined,
        @Res() res: ExpressResponse,
    ) {
        await this.loadBalancerService.refreshRouteSecretsFromControlPlane();

        const resolvedOrganizationId = await this.resolveOrganizationId({
            organizationId,
            authorizationHeader,
            cookieHeader,
            meshInternalKey,
        });

        const cookieToken = this.parseCookieToken(cookieHeader, "lb_route");
        const hintToken = tokenHeader ?? cookieToken;

        const resolved = this.loadBalancerService.resolveRoute({
            organizationId: resolvedOrganizationId,
            streamKey,
            hintToken,
        });

        if (!resolved.selected) {
            throw new ServiceUnavailableException("No healthy node available for stream routing");
        }

        const orderedCandidates = [
            ...(resolved.selected ? [resolved.selected] : []),
            ...resolved.candidates.filter((candidate) => candidate.nodeId !== resolved.selected?.nodeId),
        ];

        const upstreamHeaders = this.buildUpstreamHeaders({
            cookieHeader,
            authorizationHeader,
            routeToken: resolved.routeHintToken ?? hintToken,
        });

        let upstreamResponse: globalThis.Response | null = null;
        let selectedNodeId: string | null = null;

        for (const candidate of orderedCandidates) {
            const candidateServerUrl = this.toCandidateUpstream(candidate);
            const candidateUrl = this.loadBalancerService.buildRedirectUrl({
                serverUrl: candidateServerUrl,
                targetPath: targetPath ?? `/deployments/${streamKey}/stream`,
                replay,
                replayLimit,
            });

            try {
                const attempt = await fetch(candidateUrl, {
                    method: "GET",
                    headers: upstreamHeaders,
                });

                if (!attempt.ok || !attempt.body) {
                    continue;
                }

                upstreamResponse = attempt;
                selectedNodeId = candidate.nodeId;
                break;
            } catch {
                continue;
            }
        }

        if (!upstreamResponse?.body || !selectedNodeId) {
            this.writeReconnectSignal(res, {
                type: "lb_reconnect",
                reason: "upstream_unavailable",
                retryAfterMs: 750,
                selectedNodeId: resolved.selected?.nodeId,
                routeHintToken: resolved.routeHintToken,
                fallbackUsed: resolved.fallbackUsed,
            });
            return;
        }

        if (resolved.routeHintToken) {
            res.setHeader(
                "Set-Cookie",
                `lb_route=${encodeURIComponent(resolved.routeHintToken)}; Max-Age=60; Path=/; HttpOnly; SameSite=Lax`,
            );
            res.setHeader("X-LB-Route-Token", resolved.routeHintToken);
        }

        res.setHeader("X-LB-Selected-Node", selectedNodeId);
        res.setHeader("X-LB-Fallback-Used", resolved.fallbackUsed ? "1" : "0");
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.status(200);
        res.flushHeaders();

        const reader = upstreamResponse.body.getReader();

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }

                if (value) {
                    res.write(Buffer.from(value));
                }
            }
        } catch {
            const reconnectSignal: LoadBalancerReconnectSignal = {
                type: "lb_reconnect",
                reason: "upstream_disconnected",
                retryAfterMs: 750,
                selectedNodeId,
                routeHintToken: resolved.routeHintToken,
                fallbackUsed: resolved.fallbackUsed,
            };
            res.write(`event: ${reconnectSignal.type}\\ndata: ${JSON.stringify(reconnectSignal)}\\n\\n`);
        } finally {
            try {
                reader.releaseLock();
            } catch {
                // no-op
            }
            res.end();
        }

        return;
    }

    @All("/route/:streamKey/*targetPath")
    async routeRequest(
        @Param("streamKey") streamKey: string,
        @Param("targetPath") targetPath: string,
        @Query("organizationId") organizationId: string | undefined,
        @HttpHeader("x-lb-diag-key") diagnosticKey: string | undefined,
        @HttpHeader("x-lb-route-token") tokenHeader: string | undefined,
        @HttpHeader("authorization") authorizationHeader: string | undefined,
        @HttpHeader("x-mesh-internal-key") meshInternalKey: string | undefined,
        @HttpHeader("cookie") cookieHeader: string | undefined,
        @Req() req: ExpressRequest,
        @Res() res: ExpressResponse,
    ) {
        await this.loadBalancerService.refreshRouteSecretsFromControlPlane();

        const proxiedPath = this.buildProxiedPath(targetPath);

        if (this.parseDiagnosticPathPrefix(proxiedPath) && this.verifyDiagnosticKey(diagnosticKey)) {
            const authenticated = await this.getAuthenticatedSession({ authorizationHeader, cookieHeader });
            const diagOrgId = organizationId ?? authenticated.activeOrganizationId ?? undefined;

            const convergence = this.loadBalancerService.getLoadReportConvergence(diagOrgId);
            res.status(200);
            res.send({
                mode: "diagnostic",
                timestamp: new Date().toISOString(),
                requestedPath: proxiedPath,
                streamKey,
                userId: authenticated.userId,
                organizationId: diagOrgId ?? null,
                localNodeId: this.localNodeId(),
                convergence,
            });
            return;
        }

        const resolvedOrganizationId = await this.resolveOrganizationId({
            organizationId,
            authorizationHeader,
            cookieHeader,
            meshInternalKey,
        });

        const cookieToken = this.parseCookieToken(cookieHeader, "lb_route");
        const hintToken = tokenHeader ?? cookieToken;

        const resolved = this.loadBalancerService.resolveRoute({
            organizationId: resolvedOrganizationId,
            streamKey,
            hintToken,
        });

        if (!resolved.selected) {
            throw new ServiceUnavailableException("No healthy node available for request routing");
        }

        const orderedCandidates = [
            ...(resolved.selected ? [resolved.selected] : []),
            ...resolved.candidates.filter((candidate) => candidate.nodeId !== resolved.selected?.nodeId),
        ];

        const requestBody = this.getRequestBody(req);

        const upstreamHeaders = this.buildUpstreamHeaders({
            cookieHeader,
            authorizationHeader,
            routeToken: resolved.routeHintToken ?? hintToken,
            requestHeaders: req.headers,
            requestAccept: req.headers.accept,
        });

        let selectedNodeId: string | null = null;
        let upstreamResponse: globalThis.Response | null = null;

        for (const candidate of orderedCandidates) {
            const candidateServerUrl = this.toCandidateUpstream(candidate);
            const candidateUrl = this.loadBalancerService.buildRedirectUrl({
                serverUrl: candidateServerUrl,
                targetPath: proxiedPath,
                replay: undefined,
                replayLimit: undefined,
            });

            const finalUrl = new URL(candidateUrl);
            if (req.url.includes("?")) {
                const query = req.url.slice(req.url.indexOf("?") + 1);
                finalUrl.search = query;
            }

            try {
                const attempt = await fetch(finalUrl, {
                    method: req.method,
                    headers: upstreamHeaders,
                    body: requestBody,
                });

                if (!attempt.ok) {
                    continue;
                }

                upstreamResponse = attempt;
                selectedNodeId = candidate.nodeId;
                break;
            } catch {
                continue;
            }
        }

        if (!upstreamResponse || !selectedNodeId) {
            throw new ServiceUnavailableException("No upstream endpoint available for routed request");
        }

        if (resolved.routeHintToken) {
            res.setHeader(
                "Set-Cookie",
                `lb_route=${encodeURIComponent(resolved.routeHintToken)}; Max-Age=60; Path=/; HttpOnly; SameSite=Lax`,
            );
            res.setHeader("X-LB-Route-Token", resolved.routeHintToken);
        }

        res.setHeader("X-LB-Selected-Node", selectedNodeId);
        res.setHeader("X-LB-Fallback-Used", resolved.fallbackUsed ? "1" : "0");
        this.applyUpstreamResponseHeaders(res, upstreamResponse.headers, true);
        res.status(upstreamResponse.status);

        if (!upstreamResponse.body) {
            res.end();
            return;
        }

        const buffer = Buffer.from(await upstreamResponse.arrayBuffer());
        res.send(buffer);
    }
}