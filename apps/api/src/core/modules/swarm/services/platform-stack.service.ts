/**
 * PlatformStackService — API-driven platform stack (replaces CLI swarm
 * scripts). When the engine is in Swarm mode and `SWARM_PLATFORM_STACK` is
 * enabled (default), the API deploys its OWN platform services (ingress
 * Traefik with the swarm provider, platform overlay network) as Swarm
 * services through the dockerode SDK — no `docker stack deploy`, no CLI.
 *
 * The swarm runner's compose realizer remains the path for USER stacks;
 * this service is the platform's own stack, realized identically.
 */

import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { EnvService } from "@/config/env/env.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { SwarmClusterService } from "./swarm-cluster.service";
import { toDockerServiceSpec } from "@/modules/runners/swarm/swarm-spec.mapper";

export const PLATFORM_OVERLAY_NETWORK = "deployer-platform";
export const PLATFORM_TRAEFIK_SERVICE = "deployer-traefik";

@Injectable()
export class PlatformStackService {
    private readonly logger = new Logger(PlatformStackService.name);

    constructor(
        private readonly dockerService: DockerService,
        private readonly clusterService: SwarmClusterService,
        private readonly envService: EnvService,
    ) {}

    /**
     * Ensure the platform's own swarm stack (best-effort; callers wrap with
     * warn-only). No-op unless the engine is in an active cluster AND
     * `SWARM_PLATFORM_STACK` is enabled.
     */
    async ensurePlatformStack(): Promise<void> {
        if (!this.envService.get("SWARM_PLATFORM_STACK")) {
            return;
        }
        const snapshot = await this.clusterService.getLocalClusterSnapshot();
        if (snapshot.localNodeState !== "active") {
            return;
        }

        // 1. Platform overlay network (idempotent).
        await this.dockerService.ensureOverlayNetwork({
            name: PLATFORM_OVERLAY_NETWORK,
            driver: "overlay",
            attachable: true,
            ingress: false,
            enableIpv6: false,
            labels: {
                "deployer.managed": "true",
                "deployer.platform": "true",
            },
        });

        // 2. Traefik ingress service (swarm provider, labels-driven routing).
        await this.ensureService({
            name: PLATFORM_TRAEFIK_SERVICE,
            image: this.envService.get("MANAGED_TRAEFIK_IMAGE"),
            replicas: 1,
            env: [],
            command: [],
            args: [
                "--api.insecure=true",
                "--providers.docker=true",
                "--providers.docker.swarmMode=true",
                "--providers.docker.exposedbydefault=false",
                "--entrypoints.http.address=:80",
                "--entrypoints.websecure.address=:443",
            ],
            labels: {
                "deployer.managed": "true",
                "deployer.platform": "true",
                "deployer.ingress": "true",
            },
            containerLabels: {},
            mounts: [],
            placementPreferences: [],
            placementConstraints: ["node.labels.deployer.ingress == true"],
            resourcesLimits: {},
            resourcesReservations: {},
            networks: [PLATFORM_OVERLAY_NETWORK],
            healthcheck: null,
            updateConfig: {
                parallelism: 1,
                delayMs: 0,
                order: "start-first",
                failureAction: "rollback",
            },
            endpointPorts: [
                { targetPort: 80, publishedPort: 80, protocol: "tcp" },
                { targetPort: 443, publishedPort: 443, protocol: "tcp" },
            ],
        });

        this.logger.log(
            `Platform swarm stack ensured (network=${PLATFORM_OVERLAY_NETWORK}, traefik=${PLATFORM_TRAEFIK_SERVICE})`,
        );
    }

    /** Idempotent create-or-update of one platform service via the SDK. */
    private async ensureService(specInput: SwarmServiceSpecInput): Promise<void> {
        const spec = toDockerServiceSpec(specInput);
        try {
            const existing = await this.dockerService.inspectSwarmService(specInput.name);
            await this.dockerService.updateSwarmService(
                specInput.name,
                existing.Version.Index,
                spec,
                false,
            );
        } catch (error: unknown) {
            if (error instanceof NotFoundException) {
                const created = await this.dockerService.createSwarmService(spec);
                this.logger.log(`Created platform swarm service ${specInput.name} (id=${created.ID})`);
                return;
            }
            throw error;
        }
    }
}