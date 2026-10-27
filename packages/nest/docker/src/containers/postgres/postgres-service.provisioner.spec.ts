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
     * REGRESSION GUARD: the data directory is exclusive, so a replacement task can
     * never run alongside the old one. `start-first` would start the new task before
     * the old one released the data directory and leave the service at 0/1 forever
     * (database unreachable, API cannot boot). `stop-first` releases it first.
     */
    it("uses stop-first, because its data directory is exclusive", () => {
        const spec = buildSpec();
        expect(spec.updateConfig.order).toBe("stop-first");
    });

    /**
     * SECURITY GUARD: no host-published port. A publish bound 0.0.0.0:5432 on the
     * node put the platform's state store on every interface; consumers reach the
     * database on the platform overlay by its alias instead.
     */
    it("publishes no port and relies on the overlay alias", () => {
        const spec = buildSpec();
        expect(spec.endpointPorts).toEqual([]);
        // `networks` stays empty here: the caller attaches the resolved overlay.
        expect(spec.networks).toEqual([]);
    });
});
