import { describe, expect, it } from "vitest";
import { PostgresServiceProvisioner } from "./postgres-service.provisioner";
import type { DockerService } from "../../services/docker.service";

/**
 * `buildSpec` is pure — it reads its input and returns the desired spec, with no
 * engine call — so the provisioner is constructed with a null collaborator.
 */
function buildSpec() {
    return new PostgresServiceProvisioner(null as unknown as DockerService).buildSpec({
        identity: { databaseName: "deployer", username: "deployer", password: "deployer", image: "postgres:16-alpine" },
    });
}

describe("PostgresServiceProvisioner.buildSpec", () => {
    /**
     * REGRESSION GUARD: the port below is published in `host` mode, so only one
     * task on the node can ever hold it. `start-first` starts the replacement
     * BEFORE the old task releases the port, which the scheduler cannot satisfy:
     *
     *   "no suitable node (host-mode port already in use on 1 node)"
     *
     * and the service sits at 0/1 forever — the database becomes unreachable and
     * the API cannot boot. `stop-first` releases the port first.
     */
    it("uses stop-first, because its port is published in host mode", () => {
        const spec = buildSpec();
        expect(spec.endpointPorts.map((p) => p.publishMode)).toContain("host");
        expect(spec.updateConfig.order).toBe("stop-first");
    });

    it("publishes the database port in host mode and keeps the stable alias", () => {
        const spec = buildSpec();
        expect(spec.endpointPorts).toEqual([
            { protocol: "tcp", publishedPort: 5432, targetPort: 5432, publishMode: "host" },
        ]);
        // `networks` stays empty here: the caller attaches the resolved overlay.
        expect(spec.networks).toEqual([]);
    });
});
