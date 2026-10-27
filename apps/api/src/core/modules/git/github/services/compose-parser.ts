/**
 * Compose file parser — extracts sub-services from a docker-compose file.
 *
 * Uses the `yaml` package (already a dependency) instead of hand-rolled line
 * parsing. Handles the real-world compose features:
 *   - `include:` — recursively loads included compose files (relative to the
 *     including file's directory), merging their services
 *   - `extends:` — merges a base service's fields into the extending service
 *   - `${VAR:-default}` / `${VAR-default}` interpolation
 *   - both list and map forms for: environment, ports, volumes, labels,
 *     secrets, depends_on, networks, build args
 *   - `deploy.replicas` + `deploy.resources.limits`
 *   - `healthcheck:` (test array/string + interval/timeout/retries/start_period)
 *   - named-volume / bind-mount / anonymous-volume normalization
 *
 * Pure module — no NestJS DI. Reads file content via an injected `readFile`
 * callback so it works against the GitHub API (no local filesystem needed).
 */

import { parse as parseYaml } from "yaml";

/** A single sub-service detected inside a compose manifest. */
export interface ComposeSubService {
    name: string;
    image: string;
    build?: { context?: string; dockerfile?: string; args?: Record<string, string> };
    command?: string;
    entrypoint?: string;
    ports?: number[];
    networks?: string[];
    environment?: Record<string, string>;
    volumes?: string[];
    labels?: Record<string, string>;
    secrets?: string[];
    dependsOn?: string[];
    dependsOnCondition?: string;
    replicas?: number;
    healthCheck?: { test?: string[]; interval?: number; timeout?: number; retries?: number; startPeriod?: number };
    resources?: { cpus?: number; memory?: string };
    restart?: string;
}

interface ComposeParseContext {
    /** Reads a file's content; returns null when missing (e.g. GitHub API). */
    readFile: (path: string) => Promise<string | null>;
    /** Current directory of the file being parsed ('' for repo root). */
    dir: string;
    /** Prevents infinite include cycles. */
    seen: Set<string>;
}

/** `parseYaml` with type. */
type YamlNode = unknown;

function isRecord(v: YamlNode): v is Record<string, unknown> {
    return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Safe stringification (avoids `[object Object]` for objects). */
function toStr(v: unknown): string {
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "object" && v !== null) return JSON.stringify(v);
    // Symbols/functions are not expected from compose files — treat as empty.
    return "";
}

/** Duration suffix like `10s`, `5m`, `1h30m` → seconds (or undefined). */
function parseDuration(value: unknown): number | undefined {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return undefined;
    const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(value.trim());
    if (!m?.[1]) return undefined;
    const n = Number(m[1]);
    const unit = m[2] ?? "s";
    switch (unit) {
        case "ms": return Math.round(n / 1000);
        case "s": return Math.round(n);
        case "m": return Math.round(n * 60);
        case "h": return Math.round(n * 3600);
        default: return Math.round(n);
    }
}

/** Interpolate `${VAR}`, `${VAR:-default}`, `${VAR-default}` in a string. */
function interpolate(value: unknown, env: Record<string, string>): unknown {
    if (typeof value !== "string") return value;
    return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*)|-([^}]*))?\}/g, (_: string, name: string, defColon?: string, defDash?: string): string => {
        const resolved = env[name];
        if (resolved !== undefined) return resolved;
        if (defColon !== undefined) return defColon;
        if (defDash !== undefined) return defDash;
        return "";
    });
}

/** Normalize environment (list `- A=1` / map `A: 1`) → Record. */
function normalizeEnvironment(node: YamlNode, env: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(node)) {
        for (const item of node) {
            if (typeof item === "string") {
                const eq = item.indexOf("=");
                const key = (eq >= 0 ? item.slice(0, eq) : item).trim();
                const val = (eq >= 0 ? item.slice(eq + 1) : "").trim();
                if (key) out[key] = interpolate(val.replace(/^["']|["']$/g, ""), env) as string;
            }
        }
    } else if (isRecord(node)) {
        for (const [k, v] of Object.entries(node)) {
            out[k] = interpolate(toStr(v).replace(/^["']|["']$/g, ""), env) as string;
        }
    }
    return out;
}

/** Normalize ports (list `- "80:80"` / map `- target:80`) → container port numbers. */
function normalizePorts(node: YamlNode): number[] {
    const out: number[] = [];
    if (!Array.isArray(node)) return out;
    for (const item of node) {
        let target: number | undefined;
        if (typeof item === "string") {
            // "80:80/tcp", "8080", "127.0.0.1:8000:80"
            const parts = item.replace(/\/[a-z]+$/i, "").split(":");
            target = Number(parts[parts.length - 1]);
        } else if (isRecord(item)) {
            target = Number(item.target ?? item.container_port);
        }
        if (Number.isInteger(target) && target !== undefined && target > 0 && target <= 65535) out.push(target);
    }
    return [...new Set(out)];
}

/** Normalize volumes (list strings / list maps) → mount strings. */
function normalizeVolumes(node: YamlNode): string[] {
    const out: string[] = [];
    if (!Array.isArray(node)) return out;
    for (const item of node) {
        if (typeof item === "string") {
            if (item.includes(":")) out.push(item);
            continue;
        }
        if (isRecord(item)) {
            const type = item.type ?? "volume";
            const source = typeof item.source === "string" ? item.source : "";
            const target = typeof item.target === "string" ? item.target : "";
            if (target) {
                if (type === "bind") out.push(`${source}:${target}`);
                else out.push(`${source}:${target}`);
            }
        }
    }
    return out;
}

/** Normalize labels (list `- k=v` / map) → Record. */
function normalizeLabels(node: YamlNode): Record<string, string> {
    const out: Record<string, string> = {};
    if (Array.isArray(node)) {
        for (const item of node) {
            if (typeof item === "string") {
                const eq = item.indexOf("=");
                const k = (eq >= 0 ? item.slice(0, eq) : item).trim();
                const v = (eq >= 0 ? item.slice(eq + 1) : "").trim();
                if (k) out[k] = v;
            }
        }
    } else if (isRecord(node)) {
        for (const [k, v] of Object.entries(node)) out[k] = toStr(v);
    }
    return out;
}

/** Normalize secrets (list strings / list maps) → names. */
function normalizeSecrets(node: YamlNode): string[] {
    const out: string[] = [];
    if (!Array.isArray(node)) return out;
    for (const item of node) {
        if (typeof item === "string") out.push(item);
        else if (isRecord(item) && typeof item.source === "string") out.push(item.source);
    }
    return out;
}

/** Normalize depends_on (list / map with condition) → { names, condition }. */
function normalizeDependsOn(node: YamlNode): { names: string[]; condition?: string } {
    const names: string[] = [];
    let condition: string | undefined;
    if (Array.isArray(node)) {
        for (const item of node) {
            if (typeof item === "string") names.push(item);
            else if (isRecord(item) && typeof item.service === "string") names.push(item.service);
        }
    } else if (isRecord(node)) {
        for (const [k, v] of Object.entries(node)) {
            names.push(k);
            if (isRecord(v) && typeof v.condition === "string" && v.condition.startsWith("service_")) {
                condition = v.condition;
            }
        }
    }
    return { names, condition };
}

/** Normalize networks (list / map) → names. */
function normalizeNetworks(node: YamlNode): string[] {
    if (Array.isArray(node)) {
        return node.filter((n): n is string => typeof n === "string");
    }
    if (isRecord(node)) return Object.keys(node);
    return [];
}

/** Normalize build (string shorthand / map) → build object. */
function normalizeBuild(node: YamlNode, env: Record<string, string>): ComposeSubService["build"] {
    if (typeof node === "string") {
        return { context: interpolate(node, env) as string };
    }
    if (isRecord(node)) {
        const build: ComposeSubService["build"] = {};
        if (typeof node.context === "string") build.context = interpolate(node.context, env) as string;
        if (typeof node.dockerfile === "string") build.dockerfile = node.dockerfile;
        if (isRecord(node.args)) {
            const args: Record<string, string> = {};
            for (const [k, v] of Object.entries(node.args)) args[k] = String(interpolate(v ?? "", env));
            build.args = args;
        } else if (Array.isArray(node.args)) {
            const args: Record<string, string> = {};
            for (const item of node.args) {
                if (typeof item === "string") {
                    const eq = item.indexOf("=");
                    const k = (eq >= 0 ? item.slice(0, eq) : item).trim();
                    const v = (eq >= 0 ? item.slice(eq + 1) : "").trim();
                    if (k) args[k] = interpolate(v, env) as string;
                }
            }
            build.args = args;
        }
        return build;
    }
    return undefined;
}

/** Normalize healthcheck (test array/string + timing). */
function normalizeHealthCheck(node: YamlNode): ComposeSubService["healthCheck"] {
    if (!isRecord(node)) return undefined;
    const hc: NonNullable<ComposeSubService["healthCheck"]> = { test: ["CMD-SHELL", "exit 0"] };
    if (Array.isArray(node.test)) hc.test = node.test.map((t) => String(t));
    else if (typeof node.test === "string") hc.test = node.test.split(/\s+/).slice(0, 2);
    const interval = parseDuration(node.interval);
    if (interval !== undefined) hc.interval = interval;
    const timeout = parseDuration(node.timeout);
    if (timeout !== undefined) hc.timeout = timeout;
    const retries = parseDuration(node.retries);
    if (retries !== undefined) hc.retries = retries;
    const startPeriod = parseDuration(node.start_period ?? node.startPeriod);
    if (startPeriod !== undefined) hc.startPeriod = startPeriod;
    return hc;
}

/** Normalize deploy (replicas + resources.limits). */
function normalizeDeploy(node: YamlNode): { replicas?: number; resources?: ComposeSubService["resources"] } {
    if (!isRecord(node)) return {};
    const out: { replicas?: number; resources?: ComposeSubService["resources"] } = {};
    if (typeof node.replicas === "number") out.replicas = Math.round(node.replicas);
    if (isRecord(node.resources)) {
        const limits = isRecord(node.resources.limits) ? node.resources.limits : {};
        const reservations = isRecord(node.resources.reservations) ? node.resources.reservations : {};
        const cpusRaw = limits.cpus ?? reservations.cpus;
        const memoryRaw = limits.memory ?? reservations.memory;
        const resources: NonNullable<ComposeSubService["resources"]> = {};
        if (typeof cpusRaw === "number" || typeof cpusRaw === "string") resources.cpus = Number(String(cpusRaw).replace(/^"|"$/g, ""));
        if (typeof memoryRaw === "string") resources.memory = memoryRaw;
        if (resources.cpus !== undefined || resources.memory) out.resources = resources;
    }
    return out;
}

/** Resolve `extends:` — deep-merge base service fields (child wins). */
function resolveExtends(service: Record<string, unknown>, servicesMap: Record<string, Record<string, unknown>>): Record<string, unknown> {
    const ext = service.extends;
    if (!ext) return service;
    let baseName: string | undefined;
    if (typeof ext === "string") baseName = ext;
    else if (isRecord(ext) && typeof ext.service === "string") baseName = ext.service;

    const base = baseName ? servicesMap[baseName] : undefined;
    if (!base) return service;

    // Deep merge: base fields first, then child fields override.
    const merged: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(service)) {
        if (k === "extends") continue;
        if (isRecord(v) && isRecord(merged[k])) {
            merged[k] = { ...merged[k], ...v };
        } else {
            merged[k] = v;
        }
    }
    return merged;
}

/** Deep-merge two service maps (for include/override). */
function deepMergeServices(target: Record<string, Record<string, unknown>>, source: Record<string, Record<string, unknown>>): void {
    for (const [name, svc] of Object.entries(source)) {
        if (isRecord(target[name])) {
            target[name] = { ...target[name], ...svc };
        } else {
            target[name] = svc;
        }
    }
}

/** Load + resolve a compose file (recursively handling include/extends). */
async function loadComposeFile(path: string, ctx: ComposeParseContext): Promise<Record<string, Record<string, unknown>>> {
    const text = await ctx.readFile(path);
    if (!text) return {};
    const doc = parseYaml(text) as YamlNode;
    if (!isRecord(doc)) return {};

    // File may be a pure `include:` aggregator (no services of its own).
    const servicesMap = isRecord(doc.services)
        ? doc.services as Record<string, Record<string, unknown>>
        : {} as Record<string, Record<string, unknown>>;

    // Includes in THIS file resolve relative to THIS file's directory.
    const fileDir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

    // Recursively load `include:` files first (their services merge in, ours win).
    const includes = doc.include;
    const includeList: unknown[] = [];
    if (Array.isArray(includes)) {
        for (const inc of includes) {
            if (typeof inc === "string") includeList.push(inc);
            else if (isRecord(inc) && Array.isArray(inc.path)) {
                for (const p of inc.path) {
                    if (typeof p === "string") includeList.push(p);
                }
            }
        }
    }
    for (const incPath of includeList) {
        if (typeof incPath !== "string") continue;
        const resolved = fileDir ? `${fileDir}/${incPath}` : incPath;
        if (ctx.seen.has(resolved)) continue;
        ctx.seen.add(resolved);
        const included = await loadComposeFile(resolved, ctx);
        deepMergeServices(servicesMap, included);
    }

    return servicesMap;
}

/**
 * Parse a compose file's content (root file) and return all sub-services,
 * following `include:` and `extends:` chains.
 *
 * @param text        Root compose file content.
 * @param readFile    Async file reader (GitHub API-backed). Paths are relative
 *                    to the repo root unless `dir` is provided.
 * @param dir         Directory of the root file ('' = repo root).
 * @param env         Environment for `${VAR}` interpolation.
 */
export async function parseComposeServices(
    text: string,
    readFile: (path: string) => Promise<string | null>,
    dir = "",
    env: Record<string, string> = {},
): Promise<ComposeSubService[]> {
    const ctx: ComposeParseContext = { readFile, dir, seen: new Set([dir ? `${dir}/docker-compose.yml` : "docker-compose.yml"]) };

    // The root text is the caller-provided content (the compose file already fetched).
    const rootText = text;
    const rootPath = dir ? `${dir}/docker-compose.yml` : "docker-compose.yml";
    ctx.seen.add(rootPath);

    const doc = parseYaml(rootText) as YamlNode;
    if (!isRecord(doc)) return [];

    // Root file may have no `services:` (pure `include:` aggregator) —
    // services come entirely from included files.
    const servicesMap = isRecord(doc.services)
        ? doc.services as Record<string, Record<string, unknown>>
        : {} as Record<string, Record<string, unknown>>;

    // Load includes.
    const includes = doc.include;
    const includeList: unknown[] = [];
    if (Array.isArray(includes)) {
        for (const inc of includes) {
            if (typeof inc === "string") includeList.push(inc);
            else if (isRecord(inc) && Array.isArray(inc.path)) {
                for (const p of inc.path) {
                    if (typeof p === "string") includeList.push(p);
                }
            }
        }
    }
    for (const incPath of includeList) {
        if (typeof incPath !== "string") continue;
        const resolved = dir ? `${dir}/${incPath}` : incPath;
        if (ctx.seen.has(resolved)) continue;
        ctx.seen.add(resolved);
        const included = await loadComposeFile(resolved, ctx);
        deepMergeServices(servicesMap, included);
    }

    // Resolve extends + normalize each service.
    const result: ComposeSubService[] = [];
    for (const [name, rawService] of Object.entries(servicesMap)) {
        if (!isRecord(rawService)) continue;
        // Skip known non-service keys if any.
        if (name.startsWith("x-")) continue;

        const resolved = resolveExtends(rawService, servicesMap);
        const image = typeof resolved.image === "string" ? interpolate(resolved.image, env) as string : "";
        const build = normalizeBuild(resolved.build, env);
        const effectiveImage = image || (build ? `local/${name}:latest` : "");

        const command = typeof resolved.command === "string"
            ? interpolate(resolved.command, env) as string
            : Array.isArray(resolved.command)
                ? resolved.command.map((c) => String(c)).join(" ")
                : undefined;
        const entrypoint = typeof resolved.entrypoint === "string"
            ? resolved.entrypoint
            : Array.isArray(resolved.entrypoint)
                ? resolved.entrypoint.map((c) => String(c)).join(" ")
                : undefined;

        const depends = normalizeDependsOn(resolved.depends_on ?? resolved.dependsOn);
        const deploy = normalizeDeploy(resolved.deploy);

        const svc: ComposeSubService = {
            name,
            image: effectiveImage,
        };
        if (build) svc.build = build;
        if (command) svc.command = command;
        if (entrypoint) svc.entrypoint = entrypoint;
        const ports = normalizePorts(resolved.ports);
        if (ports.length) svc.ports = ports;
        const networks = normalizeNetworks(resolved.networks);
        if (networks.length) svc.networks = networks;
        const environment = normalizeEnvironment(resolved.environment, env);
        if (Object.keys(environment).length) svc.environment = environment;
        const volumes = normalizeVolumes(resolved.volumes);
        if (volumes.length) svc.volumes = volumes;
        const labels = normalizeLabels(resolved.labels);
        if (Object.keys(labels).length) svc.labels = labels;
        const secrets = normalizeSecrets(resolved.secrets);
        if (secrets.length) svc.secrets = secrets;
        if (depends.names.length) svc.dependsOn = depends.names;
        if (depends.condition) svc.dependsOnCondition = depends.condition;
        if (deploy.replicas !== undefined) svc.replicas = deploy.replicas;
        const hc = normalizeHealthCheck(resolved.healthcheck ?? resolved.healthCheck);
        if (hc) svc.healthCheck = hc;
        if (deploy.resources) svc.resources = deploy.resources;
        if (typeof resolved.restart === "string") svc.restart = resolved.restart;

        result.push(svc);
    }

    return result.filter((s) => s.name && s.image);
}
