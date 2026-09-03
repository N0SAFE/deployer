/**
 * PlatformRoutesSource — DB-driven source of SUPERVISED domain routes for the
 * platform ingress.
 *
 * The Traefik supervisor publishes three config families (one file per owner):
 *   - dynamic-api.yml   → this API (platform hostname)
 *   - dynamic-web.yml   → the web surface (platform hostname)
 *   - dynamic-domain.yml → EVERYTHING ELSE derived from the database
 *
 * This service produces that third family. It reads the persisted platform
 * state and answers "which Host(...) rules should Traefik publish, and to
 * which backend":
 *
 *   1. GLOBAL PUBLIC HOSTNAME / TUNNEL  — the node's globally reachable
 *      address (`node_network_config`): when the global hostname is set (e.g.
 *      `deployer.sebille.net`, kind "hostname") or a tunnel hostname exists,
 *      `Host(<address>)` → this API.
 *   2. DEPLOYMENTS  — successful deployments with a container name and domain
 *      (`deployments.domainUrl`, service `customDomains`) → the container
 *      over the platform network at the service port.
 *   3. PREVIEWS  — active preview environments (`preview_environments` +
 *      their successful deployment + service port) → the deployment's
 *      container.
 *
 * The supervisor re-reads this on every convergence (boot, entry-port change,
 * and on demand via the ingress-routes-refresher when a deployment completes
 * or the global network config changes). Every entry is Zod-validated — the
 * typed contract of what the ingress publishes.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq } from "drizzle-orm";
import z from "zod/v4";

import { GLOBAL_DATABASE_CONNECTION } from "@/core/modules/database/database-connection";
import type { GlobalDatabase } from "@/core/modules/database/global/global-database.service";
import {
	deployments,
	previewEnvironments,
	services,
} from "@/config/drizzle/global/schema";
import { nodeNetworkConfig } from "@/config/drizzle/global/schema";

/** Where a supervised route comes from — operator/web visibility + origin. */
export const supervisedRouteSourceSchema = z.enum([
	"global-hostname",
	"tunnel",
	"deployment",
	"preview",
	"custom-domain",
]);
export type SupervisedRouteSource = z.infer<typeof supervisedRouteSourceSchema>;

/** Backend of a supervised route: the API container (self) or a deployed
 *  container on the platform network. */
export const supervisedRouteTargetSchema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("api") }),
	z.object({
		kind: z.literal("container"),
		name: z.string().min(1),
		port: z.number().int().min(1),
	}),
]);
export type SupervisedRouteTarget = z.infer<typeof supervisedRouteTargetSchema>;

/** One dynamic route the platform ingress must publish. */
export const supervisedRouteSchema = z.object({
	/** Stable router key (slug of the primary host, namespaced). */
	name: z.string().regex(/^[a-z0-9-]{1,80}$/),
	/** Hostnames that route to the backend. */
	hosts: z.array(z.string().min(1)).min(1),
	source: supervisedRouteSourceSchema,
	target: supervisedRouteTargetSchema,
});
export type SupervisedRoute = z.output<typeof supervisedRouteSchema>;

/** Router name prefix — never collides with platform-api/platform-web. */
const ROUTE_NAME_PREFIX = "deploy-";

/** Sluggify a hostname into a stable router key (lowercase alnum + dash). */
export function routeNameFromHost(host: string): string {
	const slug = host
		.toLowerCase()
		.replace(/[*]+/g, "wildcard")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60);
	return `${ROUTE_NAME_PREFIX}${slug}`;
}

/** Extract the hostname from a URL-ish string (`https://app.x.com/path` → `app.x.com`). */
export function hostnameOf(urlOrHost: string): string | null {
	const trimmed = urlOrHost.trim();
	if (trimmed === "") return null;
	if (/^[a-z0-9.-]+$/i.test(trimmed) && !trimmed.includes("/")) {
		return trimmed.toLowerCase();
	}
	try {
		const host = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname;
		return host !== "" ? host : null;
	} catch {
		return null;
	}
}

@Injectable()
export class PlatformRoutesSource {
	private readonly logger = new Logger(PlatformRoutesSource.name);

	constructor(
		@Inject(GLOBAL_DATABASE_CONNECTION)
		private readonly db: GlobalDatabase,
	) {}

	/**
	 * All supervised domain routes from the database. Order matters for
	 * host-dedupe: global hostname/tunnel first (lowest priority), then
	 * deployments, then previews — the FIRST occurrence of a host wins, so
	 * preview/deployment rules are never shadowed by the global address.
	 */
	async listSupervisedRoutes(): Promise<SupervisedRoute[]> {
		const collected = new Map<string, SupervisedRoute>();

		for (const route of await this.globalHostnameRoutes()) {
			this.collectUnique(collected, route);
		}
		for (const route of await this.deploymentRoutes()) {
			this.collectUnique(collected, route);
		}
		for (const route of await this.previewRoutes()) {
			this.collectUnique(collected, route);
		}

		// One ROUTE per name (a route may claim several hosts — the map holds
		// one entry per host, so dedupe before emitting).
		const seen = new Set<string>();
		const routes: SupervisedRoute[] = [];
		for (const route of collected.values()) {
			if (seen.has(route.name)) continue;
			seen.add(route.name);
			routes.push(route);
		}

		return z.array(supervisedRouteSchema).parse(routes);
	}

	private collectUnique(collected: Map<string, SupervisedRoute>, route: SupervisedRoute): void {
		// Earlier sources win: a host already claimed (by a global address, an
		// older deployment or a preview) is never overwritten. A route whose
		// hosts ALL collide is skipped entirely.
		if (route.hosts.every((host) => collected.has(host))) return;
		for (const host of route.hosts) {
			collected.set(host, route);
		}
	}

	// ─── Global public address (hostname / tunnel) → this API ─────────────

	private async globalHostnameRoutes(): Promise<SupervisedRoute[]> {
		const rows = await this.db.select().from(nodeNetworkConfig).limit(1);
		const config = rows[0];
		if (config === undefined) return [];

		const routes: SupervisedRoute[] = [];

		// Every public entry point of the node terminates at the platform
		// TRAEFIK: a domain (Host → API) or a public IP (Host(<ip>) → API)
		// both resolve here — Traefik is the single gateway, and deployments
		// route by their own Host rules. The tunnel hostname (if set) also
		// enters Traefik and routes to the API.
		const publicHost = hostnameOf(config.publicAddress ?? "");
		if (publicHost !== null) {
			routes.push({
				name: routeNameFromHost(publicHost),
				hosts: [publicHost],
				source: "global-hostname",
				target: { kind: "api" },
			});
		}

		const tunnelHost = hostnameOf(config.tunnelHostname ?? "");
		if (tunnelHost !== null) {
			routes.push({
				name: routeNameFromHost(tunnelHost),
				hosts: [tunnelHost],
				source: "tunnel",
				target: { kind: "api" },
			});
		}

		return routes;
	}

	// ─── Successful deployments → their container:port ─────────────────────

	private async deploymentRoutes(): Promise<SupervisedRoute[]> {
		const rows = await this.db
			.select({ deployment: deployments, service: services })
			.from(deployments)
			.innerJoin(services, eq(deployments.serviceId, services.id))
			.where(eq(deployments.status, "success"))
			.orderBy(desc(deployments.createdAt));

		const routes: SupervisedRoute[] = [];
		for (const { deployment, service } of rows) {
			const containerName = deployment.containerName?.trim();
			const port = service.port;
			if (!containerName || port === null || port < 1) continue;

			const hosts: string[] = [];
			const fromDomainUrl = hostnameOf(deployment.domainUrl ?? "");
			if (fromDomainUrl !== null) hosts.push(fromDomainUrl);
			for (const custom of service.customDomains ?? []) {
				const host = hostnameOf(custom);
				if (host !== null) hosts.push(host);
			}
			if (hosts.length === 0) continue;
			const primary = hosts[0];
			if (primary === undefined) continue;

			routes.push({
				name: routeNameFromHost(primary),
				hosts,
				source: "deployment",
				target: { kind: "container", name: containerName, port },
			});
		}
		return routes;
	}

	// ─── Active preview environments → their deployment container ─────────

	private async previewRoutes(): Promise<SupervisedRoute[]> {
		const rows = await this.db
			.select({ preview: previewEnvironments, deployment: deployments, service: services })
			.from(previewEnvironments)
			.innerJoin(deployments, eq(previewEnvironments.deploymentId, deployments.id))
			.innerJoin(services, eq(deployments.serviceId, services.id))
			.where(and(eq(previewEnvironments.isActive, true), eq(deployments.status, "success")));

		const routes: SupervisedRoute[] = [];
		for (const { preview, deployment, service } of rows) {
			const containerName = deployment.containerName?.trim();
			const port = service.port;
			const host = hostnameOf(preview.fullDomain);
			if (!containerName || port === null || port < 1 || host === null) continue;

			routes.push({
				name: routeNameFromHost(host),
				hosts: [host],
				source: "preview",
				target: { kind: "container", name: containerName, port },
			});
		}
		return routes;
	}
}