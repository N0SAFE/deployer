/**
 * Swarm route verifier — verify-only mode for Traefik's Swarm provider
 * (SW-023, docs/swarm-orchestration/05 §5).
 *
 * With `providers.docker.swarmMode=true`, Traefik converges routes from
 * service labels itself — the platform must NOT hand-write dynamic config
 * for swarm-managed services. This helper probes Traefik's API
 * (`/api/http/routers`) and confirms a router exists whose rule matches the
 * host rule, with retries. It is pure (injectable `probe`), so unit tests
 * never need a live Traefik.
 */

export interface SwarmRouteVerificationResult {
    verified: boolean;
    routerName: string | null;
    matchedRule: string | null;
    attempts: number;
    error: string | null;
}

export interface SwarmRouteVerifyOptions {
    /** Base URL of the Traefik API (default `http://traefik:8080`). */
    traefikApiUrl?: string;
    maxAttempts?: number;
    retryDelayMs?: number;
    /** Injectable HTTP probe for tests — returns the parsed JSON body. */
    probe?: (url: string) => Promise<unknown>;
}

const DEFAULT_TRAEFIK_API_URL = "http://traefik:8080";
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 250;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface TraefikRouterDto {
    name?: string;
    rule?: string;
}

function extractRouters(body: unknown): TraefikRouterDto[] {
    if (!Array.isArray(body)) {
        return [];
    }
    return body.filter((item): item is TraefikRouterDto => typeof item === "object" && item !== null);
}

function normalizeHostRule(hostRule: string): string {
    // Accept "Host(`app.example.com`)" or bare "app.example.com" — compare on
    // the domain name only.
    const match = /^Host\(`(.+)`\)$/.exec(hostRule.trim());
    return (match?.[1] ?? hostRule.trim()).toLowerCase();
}

/**
 * Verify Traefik converged a router for the given host rule.
 *
 * Returns `{ verified: false }` (never throws) when the Traefik API is
 * unreachable — the swarm provider converges asynchronously, so the caller
 * treats an unverifiable probe as "pending", not "failed".
 */
export async function verifySwarmRouteAgainstTraefik(
    hostRule: string,
    options: SwarmRouteVerifyOptions = {},
): Promise<SwarmRouteVerificationResult> {
    const host = normalizeHostRule(hostRule);
    if (host.length === 0) {
        return {
            verified: false,
            routerName: null,
            matchedRule: null,
            attempts: 0,
            error: "empty host rule",
        };
    }

    const baseUrl = options.traefikApiUrl ?? DEFAULT_TRAEFIK_API_URL;
    const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);
    const retryDelayMs = Math.max(0, options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    const probe = options.probe ?? ((url: string) => fetch(url).then((r) => r.json() as Promise<unknown>));
    const url = `${baseUrl.replace(/\/+$/, "")}/api/http/routers`;

    let lastError: string | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const body = await probe(url);
            const routers = extractRouters(body);
            for (const router of routers) {
                if (!router.rule) {
                    continue;
                }
                const ruleHost = normalizeHostRule(router.rule);
                if (ruleHost === host) {
                    return {
                        verified: true,
                        routerName: router.name ?? null,
                        matchedRule: router.rule,
                        attempts: attempt,
                        error: null,
                    };
                }
            }
            lastError = `router for host '${host}' not found (attempt ${String(attempt)}/${String(maxAttempts)})`;
        } catch (error: unknown) {
            lastError = error instanceof Error ? error.message : String(error);
        }
        if (attempt < maxAttempts) {
            await sleep(retryDelayMs);
        }
    }

    return {
        verified: false,
        routerName: null,
        matchedRule: null,
        attempts: maxAttempts,
        error: lastError,
    };
}