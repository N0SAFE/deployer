import { request as httpRequest } from "node:http";

import { Context, Effect } from "effect";

import { serviceOver, type Over } from "@deployer/effect-core";

import { platformTraefikContainerName } from "@/core/modules/platform-ingress/services/platform-names";

import { ManagedWebFlagUnreadable } from "../setup.errors";
import { SetupEnvPort, SetupHostnamePort, SetupPlatformConfigPort, SetupTransportPort } from "../setup.ports";

import type { SetupPostSetupVerification, SetupVerificationTarget } from "@deployer/contracts-entities";
import type { EnvService } from "@/config/env/env.module";
import type { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import type { PlatformConfigService } from "@/core/modules/platform-ingress/services/platform-config.service";

/** One answer from an ingress for one request, before it is judged. */
export type IngressAnswer = {
	status: number;
	contentType: string;
}

/** `GET <path>` on `<address>:<port>` sending `Host: <host>`; rejects on a transport error. */
export type IngressTransport = (request: { address: string; port: number; host: string; path: string }) => Promise<IngressAnswer>;

export type RoutedVerdict = SetupVerificationTarget["routed"];

/**
 * Judge an ingress answer.
 *
 * ── WHY STATUS ALONE IS NOT ENOUGH ──────────────────────────────────────────
 * Traefik answers "I have no router for this host" with a PLAIN-TEXT 404, and the
 * routed applications answer their own 404s as HTML or JSON. That one distinction
 * is what separates "the ingress is up but has not published this route yet" —
 * the exact window the operator falls into right after the ingress swap — from a
 * route that exists and a backend that merely dislikes the path. A 5xx is the
 * backend failing behind a working route.
 *
 * Anything else, including a 401/403/404 from the app, proves the route exists.
 */
export function classifyIngressAnswer(answer: IngressAnswer): RoutedVerdict {
	if (answer.status === 404 && answer.contentType.includes("text/plain")) {
		return { ok: false, status: answer.status, detail: "the ingress is up but has no route for this hostname yet" };
	}
	if (answer.status >= 500) {
		return { ok: false, status: answer.status, detail: `the route exists but its backend answered HTTP ${String(answer.status)}` };
	}
	return { ok: true, status: answer.status, detail: `routed (HTTP ${String(answer.status)})` };
}

const PROBE_TIMEOUT_MS = 4_000;

export const nodeTransport: IngressTransport = ({ address, port, host, path }) =>
	new Promise((resolve, reject) => {
		const req = httpRequest({ host: address, port, path, method: "GET", headers: { host } }, (response) => {
			response.resume();
			resolve({ status: response.statusCode ?? 0, contentType: response.headers["content-type"] ?? "" });
		});
		req.setTimeout(PROBE_TIMEOUT_MS, () => {
			req.destroy(new Error(`no answer within ${String(PROBE_TIMEOUT_MS)}ms`));
		});
		req.on("error", reject);
		req.end();
	});

/**
 * Answers "do the API and the dashboard REALLY answer?" for the wizard's last
 * step.
 *
 * The probe goes through the CLUSTER INGRESS by its overlay name with the
 * browser's `Host` header, because the platform's own hostnames
 * (`api.deployer.localhost`) do not resolve inside a container. That is the same
 * path real traffic takes through the local door, so a pass here means the
 * routers are published — the part only the platform can see. Whether the
 * operator's BROWSER can reach the host is the other half, checked client-side
 * from the `probeUrl` returned here.
 *
 * Never throws for a failed probe: a failure is the ANSWER, and the wizard polls
 * until it passes. The one thing that does throw is not knowing whether a
 * dashboard is expected — guessing would either hide a missing dashboard or fail
 * an "API only" install forever.
 */
export class PostSetupVerificationService extends Context.Service<
	PostSetupVerificationService,
	Over<PostSetupVerificationServiceShape, PostSetupVerificationPorts>
>()("bff/PostSetupVerificationService") {
	static readonly live = serviceOver(
		Effect.all({ env: SetupEnvPort, hostnames: SetupHostnamePort, platformConfig: SetupPlatformConfigPort, transport: SetupTransportPort }),
		makePostSetupVerificationService,
	);
}

/** What the verification reads from the Effect context while it runs. */
export type PostSetupVerificationPorts = SetupEnvPort | SetupHostnamePort | SetupPlatformConfigPort | SetupTransportPort;

type Ports = {
	readonly env: EnvService;
	readonly hostnames: HostnameService;
	readonly platformConfig: PlatformConfigService;
	readonly transport: IngressTransport;
};

export type PostSetupVerificationServiceShape = {
	/** Fails only with `ManagedWebFlagUnreadable`: a failed probe is the answer, not an error. */
	readonly verify: () => Effect.Effect<SetupPostSetupVerification, ManagedWebFlagUnreadable>;
};

export function makePostSetupVerificationService({ env, hostnames, platformConfig, transport }: Ports): PostSetupVerificationServiceShape {
	/** The dashboard's browser-facing origin: an operator-set origin wins over the generated hostname. */
	const webOrigin = async (): Promise<string> => {
		const configured = (await platformConfig.getManagedWebOrigin().catch(() => null))?.trim() ?? "";
		if (configured.length === 0) return hostnames.webOrigin();
		return /^https?:\/\//i.test(configured) ? configured : `http://${configured}`;
	};

	/** Ingress addresses to try: the platform's swarm service, then a compose-managed one. */
	const ingressAddresses = (): { address: string; port: number }[] => {
		const port = env.get("MANAGED_TRAEFIK_HTTP_PORT");
		const candidates = [
			{ address: platformTraefikContainerName(env.get("DEPLOYER_PREFIX")), port: 80 },
			{ address: env.get("MANAGED_TRAEFIK_HOST"), port },
		];
		const seen = new Set<string>();
		return candidates.filter(({ address, port: candidatePort }) => {
			const key = `${address}:${String(candidatePort)}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	};

	const askIngress = (host: string, path: string): Effect.Effect<RoutedVerdict> =>
		Effect.promise(async () => {
			let last: RoutedVerdict = { ok: false, status: null, detail: "the cluster ingress did not answer" };
			// The FIRST candidate is the platform's own ingress; a later fallback must
			// not overwrite its failure with its own (an unset compose `traefik` host
			// reported "ENOTFOUND traefik" for an ingress that was merely still starting).
			let reported = false;
			for (const { address, port } of ingressAddresses()) {
				try {
					const verdict = classifyIngressAnswer(await transport({ address, port, host, path }));
					if (verdict.ok) return verdict;
					last = verdict;
				} catch (error: unknown) {
					const reason = error instanceof Error ? error.message : String(error);
					// Keep a routed verdict from an earlier candidate: "no route yet" is
					// more informative than "connection refused" from a second address.
					if (last.status === null && !reported) {
						last = { ok: false, status: null, detail: `the cluster ingress is not reachable (${reason})` };
						reported = true;
					}
				}
			}
			return last;
		});

	const verifyTarget = (input: {
		id: SetupVerificationTarget["id"];
		expected: boolean;
		host: string;
		path: string;
		probeUrl: string | null;
	}): Effect.Effect<SetupVerificationTarget> => {
		const base = { id: input.id, expected: input.expected, host: input.host, probeUrl: input.probeUrl };
		if (!input.expected) {
			return Effect.succeed({ ...base, routed: { ok: true, status: null, detail: "not part of this installation" } });
		}
		return askIngress(input.host, input.path).pipe(Effect.map((routed) => ({ ...base, routed })));
	};

	return {
		verify: () =>
			Effect.gen(function* () {
				const webExpected = yield* Effect.tryPromise({
					try: () => platformConfig.isManagedWebAppEnabled(),
					catch: (cause) => new ManagedWebFlagUnreadable({ reason: cause instanceof Error ? cause.message : String(cause), cause }),
				});
				const web = webExpected ? yield* Effect.promise(webOrigin) : null;

				const [apiTarget, webTarget] = yield* Effect.all(
					[
						verifyTarget({
							id: "api",
							expected: true,
							host: hostnames.apiHostname(),
							path: "/health/ready",
							probeUrl: `${hostnames.apiOrigin()}/health`,
						}),
						verifyTarget({ id: "web", expected: webExpected, host: hostnames.webHostname(), path: "/", probeUrl: web }),
					],
					{ concurrency: "unbounded" },
				);
				return { checkedAt: new Date().toISOString(), targets: [apiTarget, webTarget] };
			}),
	};
}
