/**
 * PlatformRoutesSource — DB-driven source of SUPERVISED routes for the platform
 * ingress (everything that is not the platform's own console).
 *
 * It reads the persisted platform state and answers "which routes should the
 * ingress publish, on which lanes, to which backend". Each route carries:
 *
 *   - a LABEL: its subdomain on the generated lanes (`<label>.deployer.localhost`
 *     on the local lane, `<label>.<private domain>` on the private one), so every
 *     deployment is reachable on this machine and on the mesh with no DNS at all;
 *   - HOSTS: explicit public DNS names (custom domains, a preview's domain), served
 *     on the public lane only;
 *   - a VISIBILITY: the service's own choice (`private` keeps it off the public lane).
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

import { GLOBAL_DATABASE_CONNECTION } from "@deployer/nest-database-core/database-connection";
import { GlobalDatabase } from "@/core/modules/database/global/global-database.service";
import { routeVisibilitySchema, type RouteVisibility } from "@deployer/contracts-entities/entities/ingress/index";
import {
	deployments,
	previewEnvironments,
	projects,
	services,
} from "@deployer/nest-schema/global";
import { nodeNetworkConfig } from "@deployer/nest-schema/global";

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
export const supervisedRouteSchema = z
	.object({
		/** Stable router key (namespaced slug). */
		name: z.string().regex(/^[a-z0-9-]{1,80}$/),
		/** Subdomain on the generated lanes, or null for a public-hosts-only route. */
		label: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/).nullable(),
		/** Explicit public hostnames (public lane only). */
		hosts: z.array(z.string().min(1)),
		visibility: routeVisibilitySchema,
		source: supervisedRouteSourceSchema,
		target: supervisedRouteTargetSchema,
	})
	.refine((route) => route.label !== null || route.hosts.length > 0, { message: "a route needs a label or a host" });
export type SupervisedRoute = z.output<typeof supervisedRouteSchema>;

/** Router name prefix — never collides with platform-api/platform-web. */
const ROUTE_NAME_PREFIX = "deploy-";

/** A DNS label: lowercase alnum + dash, max 63, no leading/trailing dash. */
export function dnsLabel(...parts: string[]): string {
	const label = parts
		.join("-")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 63)
		.replace(/-+$/g, "");
	return label === "" ? "app" : label;
}

/**
 * Keep, for each route, only the hosts and label no earlier route claimed; drop
 * routes left with nothing. Pure, so the precedence rules are tested directly.
 */
export function dedupeRoutes(ordered: readonly SupervisedRoute[]): SupervisedRoute[] {
	const claimed = new Set<string>();
	const names = new Set<string>();
	const out: SupervisedRoute[] = [];
	for (const route of ordered) {
		if (names.has(route.name)) continue;
		const hosts = route.hosts.filter((host) => !claimed.has(host));
		const label = route.label !== null && !claimed.has(`label:${route.label}`) ? route.label : null;
		if (hosts.length === 0 && label === null) continue;
		for (const host of hosts) claimed.add(host);
		if (label !== null) claimed.add(`label:${label}`);
		names.add(route.name);
		out.push({ ...route, hosts, label });
	}
	return out;
}

/** A service's ingress visibility, from its network config (default `public`). */
export function serviceVisibility(network: { visibility?: unknown } | null | undefined): RouteVisibility {
	const parsed = routeVisibilitySchema.safeParse(network?.visibility);
	return parsed.success ? parsed.data : "public";
}

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
	 * All supervised routes from the database.
	 *
	 * Order is precedence: global address first, then deployments (newest first),
	 * then previews. The FIRST source to claim a host or a label keeps it, and a
	 * later route keeps only what nobody claimed before it — so an older deployment
	 * can never take a label back from the newer one that superseded it.
	 */
	async listSupervisedRoutes(): Promise<SupervisedRoute[]> {
		return z
			.array(supervisedRouteSchema)
			.parse(
				dedupeRoutes([...(await this.globalHostnameRoutes()), ...(await this.deploymentRoutes()), ...(await this.previewRoutes())]),
			);
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
		// route by their own Host rules. The STACK's tunnel wildcard also enters
		// Traefik, which routes it by matching the Host against these routes.
		//
		// The per-node tunnel hostname is gone: the tunnel belongs to the stack
		// (a single wildcard rule covers every app), so there is no per-node
		// hostname to publish here.
		const publicHost = hostnameOf(config.publicAddress ?? "");
		if (publicHost !== null) {
			routes.push({
				name: routeNameFromHost(publicHost),
				label: null,
				hosts: [publicHost],
				visibility: "public",
				source: "global-hostname",
				target: { kind: "api" },
			});
		}

		return routes;
	}

	// ─── Successful deployments → their container:port ─────────────────────

	private async deploymentRoutes(): Promise<SupervisedRoute[]> {
		const rows = await this.db
			.select({ deployment: deployments, service: services, project: projects })
			.from(deployments)
			.innerJoin(services, eq(deployments.serviceId, services.id))
			.innerJoin(projects, eq(services.projectId, projects.id))
			.where(eq(deployments.status, "success"))
			.orderBy(desc(deployments.createdAt));

		// Newest first: the first deployment of a service claims its label, so the
		// label always routes to the latest successful deployment.
		const routes: SupervisedRoute[] = [];
		for (const { deployment, service, project } of rows) {
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
			const label = dnsLabel(service.name, project.name);
			routes.push({
				name: routeNameFromHost(label),
				label,
				hosts,
				visibility: serviceVisibility(service.network),
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
				label: dnsLabel(host.split(".")[0] ?? host),
				hosts: [host],
				visibility: serviceVisibility(service.network),
				source: "preview",
				target: { kind: "container", name: containerName, port },
			});
		}
		return routes;
	}
}