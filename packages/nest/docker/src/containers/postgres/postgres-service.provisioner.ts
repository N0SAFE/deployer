import { Injectable } from "@nestjs/common";
import { AppError } from "@repo/errors";
import { splitManagedEnv } from "@repo/env";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import type { PostgresIdentityConfig } from "../../docker-config";
import { DockerService } from "../../services/docker.service";
import { platformNetworkName, platformOverlayNetworkName } from "../../services/docker-supervisor-runtime";
import { toDockerServiceSpec } from "../../services/swarm-spec.mapper";

/**
 * PostgresServiceProvisioner — the platform's GLOBAL POSTGRES, as a swarm
 * service.
 *
 * SINGLE SOURCE OF TRUTH for the global database's desired state. Two callers
 * need it and they must never disagree:
 *
 *   - `GlobalDbSupervisorService` — owns the ONGOING desired state (keeps the
 *     service converged, reports health);
 *   - `LocalInitializationService` — needs the database UP during setup to run
 *     migrations and seed the first admin, i.e. BEFORE any supervisor
 *     registration (the supervisor registers once a database URL exists, so it
 *     cannot be the thing that creates the very first instance).
 *
 * `buildSpec()` therefore lives here and the supervisor delegates to it, so
 * the two paths can never drift into two different Postgres services.
 *
 * WHY SWARM (and not a bare container): the platform schedules EVERY supervised
 * process as a swarm service. A container-based database would have to be
 * migrated later anyway, and its host-published random port cannot survive the
 * hand-over — swarm owns the lifecycle, the named volume, and the restart
 * policy from the start.
 */

const MANAGED_CONTAINER_NAME = "deployer-postgres-dev";
const MANAGED_VOLUME_NAME = "deployer_postgres_data";

/** Legacy container name — kept only so the swarm path can delete the
 *  incarnation an older install left behind. */
export const MANAGED_POSTGRES_CONTAINER_NAME = MANAGED_CONTAINER_NAME;
/** Stable named volume persisting the API-managed Postgres data. */
export const MANAGED_POSTGRES_VOLUME_NAME = MANAGED_VOLUME_NAME;
/** Image of the API-managed Postgres service. */
export const MANAGED_POSTGRES_IMAGE = "postgres:16-alpine";
/** Container-side port of the managed Postgres. */
export const MANAGED_POSTGRES_PORT = 5432;

/**
 * Stable DNS ALIAS of the global database on the platform overlay.
 *
 * Every consumer resolves the database through this name — it is what the
 * persisted DSN host becomes once swarm owns the database, and it matches the
 * `MANAGED_GLOBAL_DB_HOST` default, so compose-managed and swarm-managed
 * installs address the database identically.
 */
export const MANAGED_POSTGRES_ALIAS = "global-db";

/**
 * Base DNS name of the managed Postgres swarm SERVICE (`deployer-postgres`).
 * Distinct from the alias: the service name identifies the object in the
 * engine, the alias is how peers resolve it. SINGLE SOURCE OF TRUTH shared by
 * the supervisor (which creates the service) and the orchestrator (which
 * persists the connection URL).
 */
const MANAGED_POSTGRES_SERVICE_BASE_NAME = "deployer-postgres";

/** The managed Postgres SWARM SERVICE name for a deployment prefix. */
export function managedPostgresServiceName(prefix?: string | null): string {
    return prefix === undefined || prefix === null || prefix === ""
        ? MANAGED_POSTGRES_SERVICE_BASE_NAME
        : `${MANAGED_POSTGRES_SERVICE_BASE_NAME}-${prefix}`;
}

/** Credentials/identity of the managed database. */
export interface PostgresServiceIdentity {
    databaseName: string;
    username: string;
    password: string;
    image: string;
}

/**
 * Credentials of the platform-managed global Postgres.
 *
 * SOURCE OF TRUTH: `managed.globalDb.*` (i.e. `MANAGED_GLOBAL_DB_USER/PASSWORD/
 * NAME`), the same keys the compose-era `global-db` service and every
 * compose-managed consumer used. Their defaults are `deployer/deployer/deployer`.
 *
 * DELIBERATELY NOT `DB_*`: in this repo those are BUILD-TIME PLACEHOLDERS
 * (`# Prod build dummy variables (test only)`), so reading them here created a
 * volume with `POSTGRES_USER=postgres` while every other consumer — and any
 * volume already on disk from the compose era — used `deployer`. Postgres only
 * applies `POSTGRES_*` on a FIRST initialization, so the mismatch surfaced as
 * `password authentication failed for user "postgres"` against a healthy
 * database.
 */
/**
 * Build the Postgres identity from the app's configuration.
 *
 * The values arrive as DATA; the app decides where they come from (env schema,
 * settings row, test fixture). `MANAGED_POSTGRES_IMAGE` is the package's own
 * constant — the image it knows how to provision — so it is not configurable
 * per app.
 */
export function toPostgresIdentity(config: PostgresIdentityConfig): PostgresServiceIdentity {
    return {
        databaseName: config.databaseName,
        username: config.username,
        password: config.password,
        image: config.image,
    };
}

@Injectable()
export class PostgresServiceProvisioner {
    constructor(protected readonly dockerService: DockerService) {}

    /**
     * Desired swarm spec for the global Postgres.
     *
     * `networks` is left EMPTY on purpose: the caller attaches the overlay it
     * resolved (the provisioner does not know the deployment prefix), via
     * `attachOverlay`.
     */
    buildSpec(input: {
        prefix?: string | null;
        identity: PostgresServiceIdentity;
    }): SwarmServiceSpecInput {
        const { databaseName, username, password, image } = input.identity;
        return {
            name: managedPostgresServiceName(input.prefix),
            image,
            mode: "replicated",
            replicas: 1,
            env: [
                `POSTGRES_DB=${databaseName}`,
                `POSTGRES_USER=${username}`,
                `POSTGRES_PASSWORD=${password}`,
            ],
            command: [],
            args: [],
            labels: {
                "deployer.managed": "true",
                "deployer.managed_reason": "global_db",
            },
            containerLabels: {},
            mounts: [
                {
                    type: "volume",
                    source: MANAGED_POSTGRES_VOLUME_NAME,
                    target: "/var/lib/postgresql/data",
                    readOnly: false,
                },
            ],
            placementPreferences: [],
            placementConstraints: [],
            resourcesLimits: {},
            resourcesReservations: {},
            networks: [],
            healthcheck: {
                test: ["CMD-SHELL", `pg_isready -U ${username} -d ${databaseName}`],
                intervalMs: 5_000,
                timeoutMs: 5_000,
                retries: 12,
                startPeriodMs: 5_000,
            },
            // ── `stop-first`, BECAUSE THE PORT IS PUBLISHED IN HOST MODE ────────
            // `start-first` starts the replacement BEFORE stopping the old task,
            // which is right for a stateless service behind a load balancer. It
            // is IMPOSSIBLE here: the port below is published in `host` mode, so
            // only one task on the node can hold it, and the replacement can
            // never start. The engine reports exactly that, and the service sits
            // at 0/1 forever:
            //
            //   "no suitable node (host-mode port already in use on 1 node)"
            //
            // Measured: after any `docker service update --force`, the new task
            // stayed `Pending` while the old one kept running, so the database
            // became unreachable and the API could not boot.
            //
            // `stop-first` gives the port up before the new task claims it. The
            // brief gap is unavoidable for a host-bound port, and the API's
            // startup guard already waits for the database to come back.
            updateConfig: { parallelism: 1, delayMs: 0, order: "stop-first", failureAction: "rollback" },
            // One task, addressed by DNS name (`global-db`): a VIP would only ever
            // forward to that same task, so the load-balancer hop is pure risk —
            // when the node's IPVS rules are missing or stale the VIP accepts
            // nothing and every consumer sees `ECONNREFUSED` while the database is
            // perfectly healthy on its own address. See the schema note.
            endpointMode: "dnsrr",
            // Postgres must be allowed to checkpoint on shutdown: stopping it
            // early (SIGKILL) corrupts the data directory, which then fails to
            // start with "could not locate a valid checkpoint record".
            stopGracePeriodSeconds: 60,
            // Published on the node running the task (host mode): a NODE-LOCAL
            // host binding is what lets an operator reach the database from the
            // host, and it never routes through the swarm ingress — the ingress
            // IPVS rejects traffic arriving from the bridge gateway, which is
            // exactly how containers used to lose the database.
            endpointPorts: [
                {
                    protocol: "tcp",
                    publishedPort: MANAGED_POSTGRES_PORT,
                    targetPort: MANAGED_POSTGRES_PORT,
                    publishMode: "host",
                },
            ],
        };
    }

    /**
     * Attach the platform overlay under both the service name and the stable
     * alias, so peers resolve the database by `global-db` regardless of the
     * deployment prefix.
     */
    attachOverlay(spec: SwarmServiceSpecInput, prefix?: string | null): SwarmServiceSpecInput {
        const base = platformNetworkName(prefix);
        spec.networks = [
            {
                target: platformOverlayNetworkName(base),
                aliases: [spec.name, MANAGED_POSTGRES_ALIAS, base === "" ? "deployer-platform" : base],
            },
        ];
        return spec;
    }

    /** Ensure the platform overlay network exists and return its name. */
    async ensureOverlay(prefix?: string | null): Promise<string> {
        const overlay = platformOverlayNetworkName(platformNetworkName(prefix));
        await this.dockerService.ensureOverlayNetwork({
            name: overlay,
            driver: "overlay",
            attachable: true,
            ingress: false,
            labels: { "deployer.managed": "true", "deployer.platform": "true" },
            enableIpv6: false,
        });
        return overlay;
    }

    /**
     * Idempotently converge the global Postgres swarm service (create or
     * update) and wait until it has a running task.
     *
     * Throws a typed `AppError` when the service never becomes healthy — the
     * caller is mid-setup and must fail loudly rather than migrate against a
     * database that is not there.
     */
    async ensure(input: {
        prefix?: string | null;
        identity: PostgresServiceIdentity;
        waitAttempts?: number;
        waitIntervalMs?: number;
    }): Promise<SwarmServiceSpecInput> {
        const spec = this.attachOverlay(this.buildSpec(input), input.prefix);
        await this.ensureOverlay(input.prefix);

        const dockerSpec = toDockerServiceSpec(spec);

        try {
            const existing = await this.dockerService.inspectSwarmService(spec.name);
            await this.dockerService.updateSwarmService(spec.name, existing.Version.Index, dockerSpec, false);
        } catch (error: unknown) {
            // NotFoundException → nothing to update, create it. Anything else
            // is a real engine failure and must surface.
            const message = error instanceof Error ? error.message : String(error);
            if (!/not found|no such service/i.test(message)) throw error;
            await this.dockerService.createSwarmService(dockerSpec);
        }

        await this.waitForRunningTask(spec.name, input.waitAttempts ?? 30, input.waitIntervalMs ?? 2_000);
        return spec;
    }

    /**
     * Poll the service until one of its tasks reports `running`. Bounded, so a
     * database that cannot start fails the caller instead of hanging setup.
     */
    private async waitForRunningTask(name: string, attempts: number, intervalMs: number): Promise<void> {
        for (let attempt = 1; attempt <= attempts; attempt++) {
            const tasks = await this.dockerService.listSwarmServiceTasks(name).catch(() => []);
            const running = tasks.filter((task) => task.Status.State === "running").length;
            if (running > 0) return;
            const rejected = tasks.find((task) => task.Status.State === "rejected");
            if (rejected !== undefined) {
                throw new AppError(
                    `Global Postgres swarm service "${name}" was rejected by the scheduler: ${
                        rejected.Status.Err ?? "no reason reported"
                    }`,
                    "POSTGRES_PROVISION_FAILED",
                    { serviceName: name, taskState: rejected.Status.State },
                );
            }
            await new Promise((resolve) => setTimeout(resolve, intervalMs));
        }
        throw new AppError(
            `Global Postgres swarm service "${name}" has no running task after ${String(attempts)} attempts`,
            "POSTGRES_PROVISION_FAILED",
            { serviceName: name, attempts },
        );
    }

    /** Remove the service (used by teardown paths and the direct-port fallback). */
    async remove(prefix?: string | null): Promise<void> {
        await this.dockerService.removeSwarmService(managedPostgresServiceName(prefix));
    }
}
