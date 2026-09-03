import { Injectable } from "@nestjs/common";
import { ServiceUnavailableError } from "@repo/errors";
import { EnvService } from "@/config/env/env.service";

interface LoadBalancerReportedResource {
    streamKey: string;
    isOwner?: boolean;
    priority?: number;
}

interface SyncLoadBalancerInput {
    deploymentId: string;
    serviceId: string;
    organizationId: string | null;
}

interface SyncLoadBalancerResult {
    applied: boolean;
    endpoint: string | null;
    status: "synced" | "skipped";
    reportedAt: string | null;
}

@Injectable()
export class DeploymentLoadBalancerSyncAdapter {
    constructor(private readonly envService: EnvService) {}

    async syncDeploymentOwnership(input: SyncLoadBalancerInput): Promise<SyncLoadBalancerResult> {
        const configuredBaseUrl = this.envService.get("LOAD_BALANCER_URL")?.toString().trim() ?? null;
        if (!configuredBaseUrl) {
            return {
                applied: false,
                endpoint: null,
                status: "skipped",
                reportedAt: null,
            };
        }

        if (!input.organizationId) {
            return {
                applied: false,
                endpoint: new URL("/internal/mesh/load-report", configuredBaseUrl).toString(),
                status: "skipped",
                reportedAt: null,
            };
        }

        const endpoint = new URL("/internal/mesh/load-report", configuredBaseUrl).toString();
        const headers = new globalThis.Headers({
            "content-type": "application/json",
        });

        const meshInternalKey = this.envService.get("MESH_STREAM_SHARED_SECRET")?.toString().trim() ?? null;
        if (meshInternalKey) {
            headers.set("x-mesh-internal-key", meshInternalKey);
        }

        const reportedAt = new Date().toISOString();
        const response = await fetch(endpoint, {
            method: "POST",
            headers,
            body: JSON.stringify({
                nodeId: this.resolveMeshNodeId(),
                serverUrl: this.resolveServerUrl(),
                organizationId: input.organizationId,
                healthy: true,
                reportedAt,
                metrics: {
                    cpuUsage: 0,
                    memoryUsage: 0,
                    activeStreams: 1,
                    queueDepth: 0,
                    errorRate: 0,
                },
                resources: this.buildOwnedResources(input),
            }),
        });

        if (!response.ok) {
            throw new ServiceUnavailableError(
                `Load balancer sync failed (${String(response.status)}) for deployment '${input.deploymentId}'`,
            );
        }

        return {
            applied: true,
            endpoint,
            status: "synced",
            reportedAt,
        };
    }

    private resolveMeshNodeId(): string {
        const fromEnv = this.envService.get("MESH_NODE_ID")?.toString().trim();
        if (fromEnv) {
            return fromEnv;
        }

        return `api-${String(process.pid)}`;
    }

    private resolveServerUrl(): string {
        const candidate =
            this.envService.get("APP_URL")?.toString().trim() ??
            this.envService.get("NEXT_PUBLIC_API_URL")?.toString().trim() ??
            "http://localhost:3005";

        try {
            return new URL(candidate).origin;
        } catch {
            return "http://localhost:3005";
        }
    }

    private buildOwnedResources(input: SyncLoadBalancerInput): LoadBalancerReportedResource[] {
        return [
            {
                streamKey: `stream:deployment:${input.deploymentId}`,
                isOwner: true,
                priority: 750,
            },
            {
                streamKey: `stream:service:${input.serviceId}`,
                isOwner: true,
                priority: 500,
            },
        ];
    }
}