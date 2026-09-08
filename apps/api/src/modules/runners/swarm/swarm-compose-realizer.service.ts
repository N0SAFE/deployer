/**
 * SwarmComposeRealizerService — Compose→Swarm transform (SW-025,
 * docs/swarm-orchestration/05 §6).
 *
 * Implements the platform's OWN compose→swarm pipeline via the dockerode SDK
 * — there is deliberately NO `docker stack deploy` (that is a client-side
 * compose transform with no Engine-API equivalent, and it would violate the
 * SDK-first rule).
 *
 * Pipeline:
 *   1. `parseComposeYaml` — YAML → canonical `ComposeModel` (Zod-validated).
 *   2. `validateCompatibility` — actionable report of unsupported constructs
 *      (build-without-image, bind volumes, links, …) so the UI can show a
 *      stack-compatibility panel before anything runs.
 *   3. `realizeCompose` — pure transform to a `ComposeRealizationPlan`
 *      (overlay networks, secrets, configs, and services in dependency
 *      order, each as a full `SwarmServiceSpecInput`).
 *   4. `executeComposePlan` — idempotent SDK application (ensure network,
 *      create secret/config once, create-or-update services).
 *
 * Everything past parsing is pure and unit-testable without a daemon; the
 * executor is the only thing touching `DockerService`.
 */

import { Injectable, Logger } from "@nestjs/common";
import { parse } from "yaml";
import { BadRequestError } from "@repo/errors";
import type {
    ComposeCompatibilityIssue,
    ComposeCompatibilityReport,
    ComposeDeploy,
    ComposeHealthcheck,
    ComposeModel,
    ComposePort,
    ComposeRealizationPlan,
    ComposeServiceModel,
    ComposeCompatibilitySeverity,
    SwarmEndpointPort,
    SwarmServiceSpecInput,
} from "@repo/contracts-entities";
import { composeModelSchema, composeServiceModelSchema } from "@repo/contracts-entities";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { toDockerServiceSpec } from "./swarm-spec.mapper";

// ─── Compose value normalizers (string forms → typed values) ────────────────

const DURATION_MS: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000 };

function toMs(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(value.trim());
    if (!match) {
        const plain = Number(value);
        return Number.isFinite(plain) ? plain : undefined;
    }
    return Number(match[1]) * (DURATION_MS[match[2] ?? "s"] ?? 1);
}

function parseMemoryBytes(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const match = /^(\d+(?:\.\d+)?)([bkmg])$/i.exec(value.trim());
    if (!match) {
        const plain = Number(value);
        return Number.isFinite(plain) ? plain : undefined;
    }
    const unit = (match[2] ?? "b").toLowerCase();
    const factor = unit === "b" ? 1 : unit === "k" ? 1024 : unit === "m" ? 1024 ** 2 : 1024 ** 3;
    return Math.trunc(Number(match[1]) * factor);
}

function parseNanoCpus(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value * 1_000_000_000);
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const plain = Number(value);
    return Number.isFinite(plain) ? Math.trunc(plain * 1_000_000_000) : undefined;
}

function normalizePorts(raw: unknown): ComposePort[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: ComposePort[] = [];
    for (const entry of raw) {
        if (typeof entry === "string") {
            // "8080:3000/tcp" | "3000" | "3000/tcp" | "127.0.0.1:8080:3000"
            const full = /^(?:[^:]+:)?(\d+):(\d+)(?:\/(tcp|udp))?$/.exec(entry.trim());
            if (full) {
                out.push({
                    targetPort: Number(full[2]),
                    publishedPort: Number(full[1]),
                    protocol: (full[3] ?? "tcp") as ComposePort["protocol"],
                });
                continue;
            }
            const short = /^(\d+)(?:\/(tcp|udp))?$/.exec(entry.trim());
            if (short) {
                out.push({
                    targetPort: Number(short[1]),
                    protocol: (short[2] ?? "tcp") as ComposePort["protocol"],
                });
                continue;
            }
            continue;
        }
        if (typeof entry === "object" && entry !== null) {
            const record = entry as Record<string, unknown>;
            const target = Number(record.target ?? record.target_port);
            if (Number.isInteger(target) && target > 0 && target <= 65535) {
                out.push({
                    targetPort: target,
                    publishedPort:
                        record.published !== undefined ? Number(record.published) : undefined,
                    protocol: (record.protocol === "udp" ? "udp" : "tcp") as ComposePort["protocol"],
                });
            }
        }
    }
    return out;
}

function normalizeEnvironment(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }
    if (typeof raw === "object" && raw !== null) {
        return Object.entries(raw as Record<string, unknown>)
            .filter(([, value]) => value !== null && value !== undefined)
            .map(([key, value]) => `${key}=${String(value)}`);
    }
    return [];
}

function normalizeMounts(raw: unknown): ComposeServiceModel["mounts"] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: ComposeServiceModel["mounts"] = [];
    for (const entry of raw) {
        if (typeof entry === "string") {
            const parts = entry.split(":");
            if (parts.length < 2) {
                continue;
            }
            const readOnly = parts[2] === "ro";
            const source = parts[0] ?? "";
            const target = parts[1] ?? "";
            const type = source.startsWith("/") || source.startsWith("~")
                ? ("bind" as const)
                : source.length === 0
                  ? ("tmpfs" as const)
                  : ("volume" as const);
            if (target.length > 0) {
                out.push({ type, source, target, readOnly });
            }
            continue;
        }
        if (typeof entry === "object" && entry !== null) {
            const record = entry as Record<string, unknown>;
            const type = record.type === "bind" || record.type === "tmpfs" || record.type === "volume"
                ? record.type
                : record.source === undefined
                  ? ("volume" as const)
                  : ("bind" as const);
            const source = typeof record.source === "string" ? record.source : "";
            out.push({
                type: type as ComposeServiceModel["mounts"][number]["type"],
                source,
                target: typeof record.target === "string" ? record.target : "",
                readOnly: record.read_only === true || record.readOnly === true,
            });
        }
    }
    return out;
}

function normalizeHealthcheck(raw: unknown): ComposeHealthcheck {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const testRaw = record.test;
    const test = Array.isArray(testRaw)
        ? testRaw.filter((entry): entry is string => typeof entry === "string")
        : typeof testRaw === "string"
          ? ["CMD-SHELL", testRaw]
          : undefined;
    return {
        ...(test && test.length > 0 ? { test } : {}),
        ...(toMs(record.interval) !== undefined ? { intervalMs: toMs(record.interval) } : {}),
        ...(toMs(record.timeout) !== undefined ? { timeoutMs: toMs(record.timeout) } : {}),
        ...(Number.isInteger(record.retries) && Number(record.retries) > 0
            ? { retries: Number(record.retries) }
            : {}),
        ...(toMs(record.start_period) !== undefined ? { startPeriodMs: toMs(record.start_period) } : {}),
    };
}

function normalizeDeploy(raw: unknown, rawRestart?: unknown): ComposeDeploy {
    if (typeof raw !== "object" || raw === null) {
        return {
            replicas: 1,
            updateOrder: "start-first",
            failureAction: "rollback",
            constraints: [],
            preferences: [],
            restartCondition: "any",
        };
    }
    const record = raw as Record<string, unknown>;
    const placement = (record.placement ?? {}) as Record<string, unknown>;
    const resources = (record.resources ?? {}) as Record<string, unknown>;
    const limits = (resources.limits ?? {}) as Record<string, unknown>;
    const update = (record.update_config ?? {}) as Record<string, unknown>;
    const restart = (record.restart_policy ?? {}) as Record<string, unknown>;
    const deployRestart =
        restart.condition === "none" || restart.condition === "on-failure"
            ? restart.condition
            : "any";
    // Service-level `restart: <policy>` (compose legacy) when no deploy block.
    const topLevelRestart =
        rawRestart === "no" ? ("none" as const)
        : rawRestart === "on-failure" ? ("on-failure" as const)
        : typeof rawRestart === "string" ? ("any" as const)
        : undefined;
    return {
        replicas: Number.isInteger(record.replicas) && Number(record.replicas) > 0
            ? Number(record.replicas)
            : 1,
        updateOrder: update.order === "stop-first" ? "stop-first" : "start-first",
        failureAction:
            update.failure_action === "pause" || update.failure_action === "continue"
                ? update.failure_action
                : "rollback",
        constraints: Array.isArray(placement.constraints)
            ? placement.constraints.filter((entry): entry is string => typeof entry === "string")
            : [],
        preferences: Array.isArray(placement.preferences)
            ? placement.preferences.filter((entry): entry is string => typeof entry === "string")
            : [],
        cpuLimit: parseNanoCpus(limits.cpus) !== undefined
            ? (parseNanoCpus(limits.cpus) ?? 0) / 1_000_000_000
            : undefined,
        memoryLimitBytes: parseMemoryBytes(limits.memory),
        restartCondition: topLevelRestart ?? deployRestart,
    };
}

function normalizeRefs(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw
            .map((entry) => (typeof entry === "string" ? entry : (entry as Record<string, unknown>)?.source))
            .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
    }
    if (typeof raw === "object" && raw !== null) {
        return Object.keys(raw as Record<string, unknown>);
    }
    return [];
}

// ─── Service builder from one compose service map entry ─────────────────────

function buildServiceModel(name: string, raw: Record<string, unknown>): ComposeServiceModel {
    const entrypoint = Array.isArray(raw.entrypoint)
        ? raw.entrypoint.filter((entry): entry is string => typeof entry === "string")
        : typeof raw.entrypoint === "string" && raw.entrypoint.length > 0
          ? [raw.entrypoint]
          : [];
    const commandRaw = raw.command;
    const command = Array.isArray(commandRaw)
        ? commandRaw.filter((entry): entry is string => typeof entry === "string")
        : typeof commandRaw === "string" && commandRaw.length > 0
          ? ["sh", "-lc", commandRaw]
          : [];

    return composeServiceModelSchema.parse({
        name,
        image: typeof raw.image === "string" && raw.image.length > 0 ? raw.image : null,
        env: normalizeEnvironment(raw.environment),
        // Compose `entrypoint` → ContainerSpec.Command; compose `command` → Args.
        command: entrypoint,
        args: command,
        labels: normalizeLabels(raw.labels),
        dependsOn: Array.isArray(raw.depends_on)
            ? raw.depends_on.map(String)
            : typeof raw.depends_on === "object" && raw.depends_on !== null
              ? Object.keys(raw.depends_on as Record<string, unknown>)
              : [],
        networks: normalizeStringList(raw.networks),
        ports: normalizePorts(raw.ports),
        mounts: normalizeMounts(raw.volumes),
        healthcheck: normalizeHealthcheck(raw.healthcheck),
        deploy: normalizeDeploy(raw.deploy, raw.restart),
        secretRefs: normalizeRefs(raw.secrets),
        configRefs: normalizeRefs(raw.configs),
    });
}

function normalizeLabels(raw: unknown): Record<string, string> {
    if (typeof raw !== "object" || raw === null) {
        return {};
    }
    return Object.fromEntries(
        Object.entries(raw as Record<string, string>)
            .filter(([, value]) => typeof value === "string")
            .map(([key, value]) => [key, value]),
    ) as Record<string, string>;
}

function normalizeStringList(raw: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.filter((entry): entry is string => typeof entry === "string");
    }
    if (typeof raw === "object" && raw !== null) {
        return Object.keys(raw as Record<string, unknown>);
    }
    return [];
}

function topoOrder(services: ComposeServiceModel[]): ComposeServiceModel[] {
    const byName = new Map(services.map((service) => [service.name, service]));
    const indegree = new Map<string, number>();
    const dependents = new Map<string, string[]>();
    for (const service of services) {
        indegree.set(service.name, service.dependsOn.filter((dep) => byName.has(dep)).length);
        for (const dep of service.dependsOn) {
            if (!byName.has(dep)) {
                continue;
            }
            const list = dependents.get(dep) ?? [];
            list.push(service.name);
            dependents.set(dep, list);
        }
    }
    const ready: string[] = [];
    for (const [name, degree] of indegree) {
        if (degree === 0) {
            ready.push(name);
        }
    }
    const ordered: ComposeServiceModel[] = [];
    while (ready.length > 0) {
        const current = ready.shift()!;
        const service = byName.get(current);
        if (service) {
            ordered.push(service);
        }
        for (const dependent of dependents.get(current) ?? []) {
            const next = (indegree.get(dependent) ?? 1) - 1;
            indegree.set(dependent, next);
            if (next === 0) {
                ready.push(dependent);
            }
        }
    }
    // Deterministic: remaining (cyclic) services in name order
    const orderedNames = new Set(ordered.map((service) => service.name));
    return [
        ...ordered,
        ...services
            .filter((service) => !orderedNames.has(service.name))
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
    ];
}

@Injectable()
export class SwarmComposeRealizerService {
    private readonly logger = new Logger(SwarmComposeRealizerService.name);

    /**
     * Parse compose YAML into the canonical typed model. Throws
     * `BadRequestError` with a readable message when the YAML is invalid or
     * the shape is not a compose file (no `services` key).
     */
    parseComposeYaml(yamlText: string): ComposeModel {
        let raw: unknown;
        try {
            raw = parse(yamlText);
        } catch (error: unknown) {
            throw new BadRequestError(
                `Invalid compose YAML: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
        if (typeof raw !== "object" || raw === null) {
            throw new BadRequestError("Compose file must contain a top-level object");
        }
        const record = raw as Record<string, unknown>;
        const servicesRaw = record.services;
        if (typeof servicesRaw !== "object" || servicesRaw === null) {
            throw new BadRequestError("Compose file has no `services` section");
        }
        const services = Object.entries(servicesRaw as Record<string, unknown>)
            .filter(([, value]) => typeof value === "object" && value !== null)
            .map(([name, value]) => buildServiceModel(name, value as Record<string, unknown>));

        const networksRaw = record.networks;
        const networks: Record<string, { driver: string; attachable: boolean; labels: Record<string, string> }> = {};
        if (typeof networksRaw === "object" && networksRaw !== null) {
            for (const [name, value] of Object.entries(networksRaw as Record<string, unknown>)) {
                const config = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
                networks[name] = {
                    driver: typeof config.driver === "string" ? config.driver : "overlay",
                    attachable: config.attachable === false ? false : true,
                    labels: normalizeLabels(config.labels),
                };
            }
        }

        return composeModelSchema.parse({
            services,
            networks,
            secrets: normalizeStringMap(record.secrets),
            configs: normalizeStringMap(record.configs),
            volumes: typeof record.volumes === "object" && record.volumes !== null
                ? Object.fromEntries(Object.keys(record.volumes as Record<string, unknown>).map((name) => [name, {}]))
                : {},
        });
    }

    /**
     * Scan the model for swarm-incompatible constructs. Errors block
     * realization; warns are actionable but non-blocking.
     */
    validateCompatibility(model: ComposeModel): ComposeCompatibilityReport {
        const issues: ComposeCompatibilityIssue[] = [];
        const push = (path: string, severity: ComposeCompatibilitySeverity, message: string) => {
            issues.push({ path, severity, message });
        };

        for (const service of model.services) {
            const base = `services.${service.name}`;
            if (!service.image) {
                push(
                    `${base}.image`,
                    "error",
                    "Image-less (build-only) service is not supported on Swarm — build the image first and reference it by image name.",
                );
            }
            const bindMounts = service.mounts.filter((mount) => mount.type === "bind");
            if (bindMounts.length > 0) {
                push(
                    `${base}.volumes`,
                    "error",
                    "Bind mounts are not supported on Swarm (they pin tasks to a single host). Use named volumes instead.",
                );
            }
            if (service.ports.length > 1) {
                push(
                    `${base}.ports`,
                    "warn",
                    "Multiple published ports: only the Routing Mesh / Traefik path is guaranteed across nodes; verify ingress config.",
                );
            }
            if (service.secretRefs.length > 0 || service.configRefs.length > 0) {
                push(
                    `${base}.secrets/configs`,
                    "warn",
                    "Secret/config objects are created at stack level; per-service mount references are a follow-up.",
                );
            }
            const missingNetworks = service.networks.filter(
                (name) => !model.networks[name] && name !== "default",
            );
            if (missingNetworks.length > 0) {
                push(
                    `${base}.networks`,
                    "warn",
                    `Network(s) ${missingNetworks.join(", ")} not declared at the top level — will be auto-created as overlay.`,
                );
            }
        }

        issues.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
        return { issues };
    }

    /**
     * Pure transform: ComposeModel → realization plan. Service order is
     * dependency-ordered (`depends_on` topological sort); each service is a
     * full `SwarmServiceSpecInput` ready for `toDockerServiceSpec`.
     */
    realizeCompose(
        model: ComposeModel,
        context: { projectId: string; deploymentId: string },
    ): ComposeRealizationPlan {
        const managedLabels: Record<string, string> = {
            "deployer.managed": "true",
            "deployer.managed_by": "compose_realizer",
            "deployer.managed_reason": "compose_stack",
            "deployer.project_id": context.projectId,
            "deployer.deployment_id": context.deploymentId,
        };

        const planNetworks = Object.entries(model.networks).map(([name, config]) => ({
            name: `deployer-${context.projectId}-${name}`,
            driver: config.driver,
            attachable: config.attachable,
            labels: { ...managedLabels, "deployer.compose_network": name },
        }));

        const secrets = Object.entries(model.secrets).map(([name, data]) => ({
            name: `deployer-${context.projectId}-secret-${name}`,
            data,
        }));
        const configs = Object.entries(model.configs).map(([name, data]) => ({
            name: `deployer-${context.projectId}-config-${name}`,
            data,
        }));

        const baseNetworks = model.services.some((service) => service.networks.includes("default"))
            ? ["default"]
            : [];

        const services = topoOrder(model.services).map((service) => {
            const spec: SwarmServiceSpecInput = {
                name: `deployer-${context.projectId}-${service.name}`,
                image: service.image ?? "busybox:latest",
                mode: "replicated",
                replicas: service.deploy.replicas,
                env: service.env,
                command: service.command,
                args: service.args,
                labels: { ...managedLabels, "deployer.compose_service": service.name, ...service.labels },
                containerLabels: {},
                mounts: service.mounts
                    .filter((mount) => mount.type === "volume")
                    .map((mount) => ({
                        type: "volume" as const,
                        source: `deployer-${context.projectId}-${mount.source}`,
                        target: mount.target,
                        readOnly: mount.readOnly,
                    })),
                placementPreferences: service.deploy.preferences.map((descriptor) => ({ spreadDescriptor: descriptor })),
                placementConstraints: service.deploy.constraints,
                resourcesLimits: {
                    ...(service.deploy.cpuLimit !== undefined
                        ? { nanoCpus: Math.trunc(service.deploy.cpuLimit * 1_000_000_000) }
                        : {}),
                    ...(service.deploy.memoryLimitBytes !== undefined
                        ? { memoryBytes: service.deploy.memoryLimitBytes }
                        : {}),
                },
                resourcesReservations: {},
                networks: [
                    ...baseNetworks,
                    ...service.networks
                        .filter((name) => name !== "default" && model.networks[name])
                        .map((name) => `deployer-${context.projectId}-${name}`),
                ],
                healthcheck: service.healthcheck,
                updateConfig: {
                    parallelism: 1,
                    delayMs: 0,
                    order: service.deploy.updateOrder,
                    failureAction: service.deploy.failureAction,
                },
                endpointPorts: service.ports.map((port): SwarmEndpointPort => ({
                    targetPort: port.targetPort,
                    ...(port.publishedPort !== undefined ? { publishedPort: port.publishedPort } : {}),
                    protocol: port.protocol,
                })),
            };
            return { serviceName: service.name, spec };
        });

        return {
            networks: planNetworks,
            secrets,
            configs,
            services,
        };
    }

    /**
     * Apply the plan idempotently via the SDK. Networks are ensured (create
     * once, reuse by name); secrets/configs are created only when absent;
     * services are created-or-updated by name. Returns a summary.
     */
    async executeComposePlan(
        plan: ComposeRealizationPlan,
    ): Promise<{
        networks: string[];
        secrets: string[];
        configs: string[];
        createdServices: string[];
        updatedServices: string[];
    }> {
        const createdServices: string[] = [];
        const updatedServices: string[] = [];
        const networks: string[] = [];
        const secrets: string[] = [];
        const configs: string[] = [];

        const dockerService = this.dockerService;
        for (const network of plan.networks) {
            await dockerService.ensureOverlayNetwork({
                name: network.name,
                driver: network.driver,
                attachable: network.attachable,
                ingress: false,
                enableIpv6: false,
                labels: network.labels,
            });
            networks.push(network.name);
        }

        const existingSecrets = new Set((await dockerService.listSwarmSecrets()).map((secret) => secret.Spec?.Name));
        for (const secret of plan.secrets) {
            if (!existingSecrets.has(secret.name)) {
                await dockerService.createSwarmSecret({
                    name: secret.name,
                    data: secret.data,
                    labels: { "deployer.managed": "true" },
                });
            }
            secrets.push(secret.name);
        }

        const existingConfigs = new Set((await dockerService.listSwarmConfigs()).map((config) => config.Spec?.Name));
        for (const config of plan.configs) {
            if (!existingConfigs.has(config.name)) {
                await dockerService.createSwarmConfig({
                    name: config.name,
                    data: config.data,
                    labels: { "deployer.managed": "true" },
                });
            }
            configs.push(config.name);
        }

        for (const entry of plan.services) {
            const serviceName = entry.spec.name;
            const spec = toDockerServiceSpec(entry.spec);
            try {
                const existing = await dockerService.inspectSwarmService(serviceName);
                await dockerService.updateSwarmService(serviceName, existing.Version.Index, spec, false);
                updatedServices.push(serviceName);
            } catch (error: unknown) {
                if (error instanceof Error && error.message.toLowerCase().includes("not found")) {
                    const created = await dockerService.createSwarmService(spec);
                    createdServices.push(created.ID);
                } else {
                    throw error;
                }
            }
        }

        this.logger.log(
            `Compose realization applied: ${String(createdServices.length)} created / ${String(updatedServices.length)} updated services, ` +
                `${String(networks.length)} networks, ${String(secrets.length)} secrets, ${String(configs.length)} configs`,
        );
        return { networks, secrets, configs, createdServices, updatedServices };
    }

    private readonly dockerService: DockerService;

    constructor(dockerService: DockerService) {
        this.dockerService = dockerService;
    }
}

function normalizeStringMap(raw: unknown): Record<string, string> {
    if (typeof raw !== "object" || raw === null) {
        return {};
    }
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof value === "string") {
            out[key] = value;
        } else if (typeof value === "object" && value !== null) {
            const record = value as Record<string, unknown>;
            if (typeof record.file === "string") {
                out[key] = record.file;
            } else if (typeof record.content === "string") {
                out[key] = record.content;
            } else {
                out[key] = "";
            }
        }
    }
    return out;
}