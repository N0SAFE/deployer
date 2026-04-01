import { Injectable } from "@nestjs/common";
import { Observable, defer, from, mergeMap } from "rxjs";
import { createORPCClient } from "@orpc/client";
import type { ContractRouterClient } from "@orpc/contract";
import { OpenAPILink } from "@orpc/openapi-client/fetch";
import { appContract, type AppContract } from "@repo/api-contracts";
import { signMeshToken } from "@repo/auth/mesh";
import { EnvService } from "@/config/env/env.service";
import {
    eq,
    meshFields,
    meshStreamResourceSchema,
    path,
    SystemMeshResourceDiscoveryService,
} from "@/core/modules/mesh/services/system-mesh-resource-discovery.service";
import { SystemMeshConfigService } from "@/core/modules/mesh/services/system-mesh-config.service";

const streamFields = meshFields(meshStreamResourceSchema);

export interface MeshOpenInternalBridgeInput<TEvent> {
    context: unknown;
    organizationId?: string | null;
    resourceKey: string;
    localEndpointPath: string;
    metadata: {
        streamType: string;
        streamId: string;
    };
    executeRemote: (client: ContractRouterClient<AppContract>) => PromiseLike<Observable<TEvent>>;
}

@Injectable()
export class MeshStreamRuntimeService {
    constructor(
        private readonly meshResourceDiscoveryService: SystemMeshResourceDiscoveryService,
        private readonly meshConfigService: SystemMeshConfigService,
        private readonly envService: EnvService,
    ) {}

    openInternalBridge<TEvent>(input: MeshOpenInternalBridgeInput<TEvent>): Observable<TEvent> | null {
        const organizationId = input.organizationId ?? this.resolveOrganizationScope(input.context);
        const localServerUrl = this.resolveLocalServerUrl();

        const remote = this.meshResourceDiscoveryService
            .select(meshStreamResourceSchema)
            .where({
                organizationId,
                includeCandidates: true,
            })
            .where(
                eq(streamFields.key, input.resourceKey),
                eq(streamFields.protocol, "sse"),
                eq(path(streamFields.metadata, "streamType"), input.metadata.streamType),
                eq(path(streamFields.metadata, "streamId"), input.metadata.streamId),
            )
            .autoRegister({
                organizationId,
                key: input.resourceKey,
                ownerServerUrl: localServerUrl,
                endpointPath: input.localEndpointPath,
                endpointMethod: "GET",
                protocol: "sse",
                persistentConnectionRequired: true,
                priority: 500,
                version: 1,
                metadata: {
                    streamType: input.metadata.streamType,
                    streamId: input.metadata.streamId,
                },
            })
            .firstRemote();

        if (!remote || !remote.ownerServerUrl) {
            return null;
        }

        const headers = this.buildProxyHeaders(input.context);
        const client = this.createRemoteClient(remote.ownerServerUrl, headers);

        return defer(() =>
            from(input.executeRemote(client)).pipe(
                mergeMap((stream$) => stream$),
            ),
        );
    }

    private createRemoteClient(
        baseUrl: string,
        headers: Record<string, string>,
    ): ContractRouterClient<AppContract> {
        const link = new OpenAPILink(appContract, {
            url: baseUrl,
            headers: () => headers,
            fetch: (input, init) => fetch(input, init),
        });

        return createORPCClient<ContractRouterClient<AppContract>>(link);
    }

    private resolveOrganizationScope(context: unknown): string | null {
        const authContext =
            context && typeof context === "object" && "auth" in context
                ? (context as { auth?: { session?: { activeOrganizationId?: unknown } | null } }).auth
                : undefined;

        const activeOrganizationId = authContext?.session?.activeOrganizationId;
        return typeof activeOrganizationId === "string" && activeOrganizationId.length > 0
            ? activeOrganizationId
            : null;
    }

    private resolveLocalServerUrl(): string {
        const candidate =
            this.meshConfigService.getNodeServerUrl() ??
            this.envService.get("APP_URL")?.toString().trim() ??
            "http://localhost:3005";

        try {
            return new URL(candidate).origin;
        } catch {
            return "http://localhost:3005";
        }
    }

    private buildProxyHeaders(context: unknown): Record<string, string> {
        const headers: Record<string, string> = {
            accept: "text/event-stream",
            "cache-control": "no-cache",
        };

        const request =
            context && typeof context === "object" && "request" in context
                ? (context as { request?: Request }).request
                : undefined;

        if (!request) {
            return headers;
        }

        const authorization = request.headers.get("authorization");
        if (authorization) {
            headers.authorization = authorization;
        }

        const cookie = request.headers.get("cookie");
        if (cookie) {
            headers.cookie = cookie;
        }

        const meshInternalKey = this.resolveMeshInternalCredential(request);

        if (meshInternalKey && meshInternalKey.length > 0) {
            headers["x-mesh-internal-key"] = meshInternalKey;
        }

        return headers;
    }

    private resolveMeshInternalCredential(request: Request): string | null {
        const configuredSecret = this.meshConfigService.getStreamSharedSecret();
        if (configuredSecret && configuredSecret.length > 0) {
            return signMeshToken(configuredSecret);
        }

        const forwarded =
            request.headers.get("x-mesh-internal-key") ??
            request.headers.get("X-Mesh-Internal-Key") ??
            null;

        return forwarded && forwarded.length > 0 ? forwarded : null;
    }
}