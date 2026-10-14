import { Injectable, Logger } from "@nestjs/common";
import { request as httpRequest } from "node:http";
import type { SetupPostSetupVerification, SetupVerificationTarget } from "@repo/contracts-entities";

import { EnvService } from "@/config/env/env.module";
import { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import { PlatformConfigService } from "@/core/modules/platform-ingress/services/platform-config.service";
import { platformTraefikContainerName } from "@/core/modules/platform-ingress/services/platform-names";

/** One answer from an ingress for one request, before it is judged. */
export interface IngressAnswer {
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

const nodeTransport: IngressTransport = ({ address, port, host, path }) =>
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
@Injectable()
export class PostSetupVerificationService {
	private readonly logger = new Logger(PostSetupVerificationService.name);

	/** Seam for specs; production uses the node `http` transport. */
	transport: IngressTransport = nodeTransport;

	constructor(
		private readonly env: EnvService,
		private readonly hostnames: HostnameService,
		private readonly platformConfig: PlatformConfigService,
	) {}

	async verify(): Promise<SetupPostSetupVerification> {
		const webExpected = await this.platformConfig.isManagedWebAppEnabled();
		const webOrigin = webExpected ? await this.webOrigin() : null;

		const [api, web] = await Promise.all([
			this.verifyTarget({
				id: "api",
				expected: true,
				host: this.hostnames.apiHostname(),
				path: "/health/ready",
				probeUrl: `${this.hostnames.apiOrigin()}/health`,
			}),
			this.verifyTarget({
				id: "web",
				expected: webExpected,
				host: this.hostnames.webHostname(),
				path: "/",
				probeUrl: webOrigin,
			}),
		]);
		return { checkedAt: new Date().toISOString(), targets: [api, web] };
	}

	/** The dashboard's browser-facing origin: an operator-set origin wins over the generated hostname. */
	private async webOrigin(): Promise<string> {
		const configured = (await this.platformConfig.getManagedWebOrigin().catch(() => null))?.trim() ?? "";
		if (configured.length === 0) return this.hostnames.webOrigin();
		return /^https?:\/\//i.test(configured) ? configured : `http://${configured}`;
	}

	private async verifyTarget(input: {
		id: SetupVerificationTarget["id"];
		expected: boolean;
		host: string;
		path: string;
		probeUrl: string | null;
	}): Promise<SetupVerificationTarget> {
		const base = { id: input.id, expected: input.expected, host: input.host, probeUrl: input.probeUrl };
		if (!input.expected) {
			return { ...base, routed: { ok: true, status: null, detail: "not part of this installation" } };
		}
		return { ...base, routed: await this.askIngress(input.host, input.path) };
	}

	/** Ingress addresses to try: the platform's swarm service, then a compose-managed one. */
	private ingressAddresses(): { address: string; port: number }[] {
		const port = this.env.get("MANAGED_TRAEFIK_HTTP_PORT");
		const candidates = [
			{ address: platformTraefikContainerName(this.env.get("DEPLOYER_PREFIX")), port: 80 },
			{ address: this.env.get("MANAGED_TRAEFIK_HOST"), port },
		];
		const seen = new Set<string>();
		return candidates.filter(({ address, port: candidatePort }) => {
			const key = `${address}:${String(candidatePort)}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	}

	private async askIngress(host: string, path: string): Promise<RoutedVerdict> {
		let last: RoutedVerdict = { ok: false, status: null, detail: "the cluster ingress did not answer" };
		// The FIRST candidate is the platform's own ingress; a later fallback must
		// not overwrite its failure with its own (an unset compose `traefik` host
		// reported "ENOTFOUND traefik" for an ingress that was merely still starting).
		let reported = false;
		for (const { address, port } of this.ingressAddresses()) {
			try {
				const verdict = classifyIngressAnswer(await this.transport({ address, port, host, path }));
				if (verdict.ok) return verdict;
				last = verdict;
			} catch (error: unknown) {
				const reason = error instanceof Error ? error.message : String(error);
				this.logger.debug(`Ingress ${address}:${String(port)} did not answer for ${host}: ${reason}`);
				// Keep a routed verdict from an earlier candidate: "no route yet" is
				// more informative than "connection refused" from a second address.
				if (last.status === null && !reported) {
					last = { ok: false, status: null, detail: `the cluster ingress is not reachable (${reason})` };
					reported = true;
				}
			}
		}
		return last;
	}
}
