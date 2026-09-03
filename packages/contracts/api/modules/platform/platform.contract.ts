import z from "zod/v4";
import { standard, standardDomainErrorContracts, standardDomainErrorPayloadSchema } from "@repo/orpc-utils";

// ─── Shared schemas ─────────────────────────────────────────────────────────

export const appInstanceEntityOutputSchema = z.object({
	id: z.uuid(),
	label: z.string().min(1),
	kind: z.enum(["managed", "external"]),
	status: z.enum(["active", "stale", "revoked"]),
	lastSeenAt: z.date(),
	createdAt: z.date(),
});

export const registerAppInstanceInputSchema = z.object({
	email: z.string().min(3),
	password: z.string().min(1),
	instanceLabel: z.string().min(1),
});

export const registerAppInstanceOutputSchema = z.object({
	instanceId: z.string().min(1),
	appToken: z.string().min(1),
	heartbeatIntervalMs: z.number().int().positive(),
});

export const heartbeatAppInstanceInputSchema = z.object({});

/**
 * Instance identity header — decoded by the ORPC codec into `input.headers`.
 * Presence/format is validated here; semantic verification (token exists,
 * active) happens in the `requireAppInstance()` ORPC middleware.
 */
export const appInstanceTokenHeadersSchema = z.object({
	// Optional at the schema level so a MISSING header reaches the
	// requireAppInstance middleware, which enforces presence with a proper
	// 401 (schema-level rejection would surface as an opaque 400).
	"x-app-instance-token": z.string().min(1).optional(),
});

export const heartbeatAppInstanceOutputSchema = z.object({
	renewUntil: z.date(),
});

export const listAppInstancesInputSchema = z.object({});
export const listAppInstancesOutputSchema = z.object({
	instances: z.array(appInstanceEntityOutputSchema),
});

export const revokeAppInstanceInputSchema = z.object({
	instanceId: z.uuid(),
});
export const revokeAppInstanceOutputSchema = z.object({
	revoked: z.boolean(),
});

// ─── Platform ingress (entry port, global network, tunnels) ────────────────

/** Status of the platform Traefik resource. */
export const ingressTraefikStateSchema = z.object({
	supervisorId: z.string(),
	/** "converged" | "degraded" | "idle" — degraded = the port is NOT serving. */
	state: z.enum(["idle", "converging", "converged", "degraded"]),
	healthy: z.boolean(),
	detail: z.string().nullable(),
	warnings: z.array(z.string()),
	/** The port Traefik is DESIRED to publish (0 when headless/prod). */
	desiredPort: z.number().int().min(0),
	/** True when Traefik actually holds a host-port binding at runtime. */
	hostPublished: z.boolean(),
});
export type IngressTraefikState = z.infer<typeof ingressTraefikStateSchema>;

/** The platform's entry point configuration. */
export const ingressEntrySchema = z.object({
	/** Host port the entry point publishes (default 80). */
	port: z.number().int().min(1).max(65535),
	/** True when the port is the default 80 (plain global DNS just works). */
	isDefault80: z.boolean(),
	/** Where the value came from. */
	sourcedFrom: z.enum(["local-db", "env", "default"]),
});
export type IngressEntry = z.infer<typeof ingressEntrySchema>;

/** Global network / domain configuration for the platform entry point. */
export const ingressGlobalNetworkSchema = z.object({
	/** Public DNS domain pointed at THIS machine (plain), e.g. app.example.com. */
	globalDomain: z.string().min(1).nullable(),
	/** Cloudflare tunnel domain, e.g. tunnel.sebille.net. */
	tunnelDomain: z.string().min(1).nullable(),
	/** Cloudflare tunnel target = the entry port (traefik). */
	tunnelTargetPort: z.number().int().min(1).max(65535),
	/**
	 * Live reachability of the global domain (probed just-in-time when the
	 * web asks). null = unknown / not configured / probe skipped.
	 */
	reachability: z
		.object({
			reachable: z.boolean(),
			checkedAt: z.string().datetime().nullable(),
			reason: z.string().nullable(),
			/** When the domain fails AND entry port != 80, this flag drives the alert. */
			suspectedEntryPortMismatch: z.boolean(),
		})
		.nullable(),
});
export type IngressGlobalNetwork = z.infer<typeof ingressGlobalNetworkSchema>;

/** Combined ingress state the web config page consumes. */
export const ingressStateOutputSchema = z.object({
	entry: ingressEntrySchema,
	traefik: ingressTraefikStateSchema,
	globalNetwork: ingressGlobalNetworkSchema,
});

export const setEntryPortInputSchema = z.object({
	port: z.number().int().min(1).max(65535),
});

export const setGlobalNetworkInputSchema = z.object({
	/** Public DNS domain pointed at this machine — null clears it. */
	globalDomain: z.string().min(1).nullable().optional(),
	/** Cloudflare tunnel domain — null clears it. */
	tunnelDomain: z.string().min(1).nullable().optional(),
});

export const setGlobalNetworkOutputSchema = z.object({
	globalNetwork: ingressGlobalNetworkSchema,
	/** True when a live reachability probe was performed for a configured global domain. */
	probed: z.boolean(),
});

// ─── Managed web app (platform console surface) ─────────────────────────────

/** Identity of the web app's OWN Cloudflare tunnel (its own hostname/ingress,
 *  distinct from the node's global tunnel which serves the API). */
export const managedWebTunnelIdentitySchema = z.object({
	tunnelId: z.string().min(1),
	hostname: z.string().min(1),
	providerId: z.string().min(1),
});
export type ManagedWebTunnelIdentity = z.infer<typeof managedWebTunnelIdentitySchema>;

/**
 * Full state of the managed web app console. Consumed by BOTH visuals of the
 * single console URL (`/manage/web-app`): the beautiful web page (web app
 * running) and the API HTML console (web app stopped — same URL falls back to
 * the API via a Traefik PathPrefix rule).
 */
export const managedWebStateOutputSchema = z.object({
	/** `managed_web_app.enabled` DB flag (DB wins after first boot). */
	enabled: z.boolean(),
	/** MANAGED_WEB_APP_EXTERNAL — compose side-by-side dev: lifecycle owned by the developer. */
	external: z.boolean(),
	/** Platform web hostname (web.<prefix>deployer.localhost). */
	webHostname: z.string().min(1),
	/** Custom public origin (domain/IP) of the web app — null = platform hostname. */
	customOrigin: z.string().nullable(),
	/** The web app's own tunnel — null = none provisioned. */
	tunnel: managedWebTunnelIdentitySchema.nullable(),
	/** Reconciler state ("idle" | "converging" | "converged" | "degraded"). */
	supervisorState: z.string().nullable(),
	/** Supervisor health, null when the supervisor is not registered. */
	healthy: z.boolean().nullable(),
	detail: z.string().nullable(),
});
export type ManagedWebState = z.infer<typeof managedWebStateOutputSchema>;

/** Set/clear the custom public origin. `null` (or empty) clears it. */
export const setManagedWebOriginInputSchema = z.object({
	origin: z.string().min(1).nullable(),
});

export const setManagedWebOriginOutputSchema = z.object({
	state: managedWebStateOutputSchema,
});

/** Provision the web app's own tunnel on a Cloudflare app (zone must own the hostname). */
export const enableManagedWebTunnelInputSchema = z.object({
	hostname: z.string().min(1),
});

export const enableManagedWebTunnelOutputSchema = z.object({
	state: managedWebStateOutputSchema,
});

/** Common output for toggling/restarting/removing the web tunnel — always returns fresh state. */
export const managedWebActionOutputSchema = z.object({
	state: managedWebStateOutputSchema,
});

// ─── Contracts ──────────────────────────────────────────────────────────────

const registerOps = standard.zod(registerAppInstanceOutputSchema, "registerAppInstance");
/**
 * BYO registration: a web instance proves an account on THIS API and receives
 * its own (non-user) token. Rate limiting is applied server-side.
 */
export const registerAppInstanceContract = registerOps
	.create()
	.path("/platform/app-instances/register")
	.input((b) => b.body(registerAppInstanceInputSchema))
	.output((b) => b.body(registerAppInstanceOutputSchema))
	.errors((e) => [
		...standardDomainErrorContracts(e),
		e("TOO_MANY_REQUESTS")
			.message("Too many registration attempts")
			.status(429)
			.data(standardDomainErrorPayloadSchema),
	])
	.build();

const heartbeatOps = standard.zod(heartbeatAppInstanceOutputSchema, "heartbeatAppInstance");
/** Authenticated by the X-App-Instance-Token header (typed detailed input). */
export const heartbeatAppInstanceContract = heartbeatOps
	.create()
	.path("/platform/app-instances/heartbeat")
	.input((b) => b.body(heartbeatAppInstanceInputSchema).headers(appInstanceTokenHeadersSchema))
	.output((b) => b.body(heartbeatAppInstanceOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

const listOps = standard.zod(listAppInstancesOutputSchema, "listAppInstances");
export const listAppInstancesContract = listOps
	.list()
	.path("/platform/app-instances")
	.input((b) => b.body(listAppInstancesInputSchema))
	.output((b) => b.body(listAppInstancesOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

const revokeOps = standard.zod(revokeAppInstanceOutputSchema, "revokeAppInstance");
export const revokeAppInstanceContract = revokeOps
	.delete()
	.path("/platform/app-instances/revoke")
	.input((b) => b.body(revokeAppInstanceInputSchema))
	.output((b) => b.body(revokeAppInstanceOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

const ingressOps = standard.zod(ingressStateOutputSchema, "getIngressState");
/**
 * READ the platform ingress state (entry port, Traefik status, global network
 * + tunnel). Admin (requireAuth) — powers the developer/ingress config page.
 */
export const getIngressStateContract = ingressOps
	.create()
	.path("/platform/ingress/state")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(ingressStateOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * SET the platform entry port (the port Traefik publishes). The Traefik
 * container is restarted on the new port and re-probed. Returns the new state.
 */
export const setEntryPortContract = standard
	.zod(ingressStateOutputSchema, "setEntryPort")
	.create()
	.path("/platform/ingress/entry-port")
	.input((b) => b.body(setEntryPortInputSchema))
	.output((b) => b.body(ingressStateOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * RESTART Traefik on its current entry port and re-probe liveness. Used by
 * the web "fix ingress" flow after the operator freed a conflicting port.
 */
export const restartTraefikContract = standard
	.zod(ingressStateOutputSchema, "restartTraefik")
	.create()
	.path("/platform/ingress/restart")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(ingressStateOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/**
 * SET the global network surface: a public global DNS domain (plain, pointed
 * at this machine) and/or a Cloudflare tunnel domain. The tunnel always
 * targets the entry port (Traefik). When a global domain is configured, a
 * live reachability probe runs and reports the entry-port-mismatch suspect.
 */
export const setGlobalNetworkContract = standard
	.zod(setGlobalNetworkOutputSchema, "setGlobalNetwork")
	.create()
	.path("/platform/ingress/global-network")
	.input((b) => b.body(setGlobalNetworkInputSchema))
	.output((b) => b.body(setGlobalNetworkOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

// ─── Managed web console contracts ────────────────────────────────────────

/**
 * READ the managed web app state. Public like the HTML console it mirrors —
 * the single console URL (`/manage/web-app`) must keep working even when the
 * web app is stopped (Traefik falls back to the API console; a logged-out
 * operator still gets the status).
 */
export const getManagedWebStateContract = standard
	.zod(managedWebStateOutputSchema, "getManagedWebState")
	.read()
	.path("/platform/managed-web/state")
	.input(z.object({}))
	.output(managedWebStateOutputSchema)
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Flip `managed_web_app.enabled` and converge (Traefik console route flips
 *  the visual: web app ↔ API console). */
export const toggleManagedWebContract = standard
	.zod(managedWebActionOutputSchema, "toggleManagedWeb")
	.create()
	.path("/platform/managed-web/toggle")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(managedWebActionOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Force a restart of the managed web container (also enables it). */
export const restartManagedWebContract = standard
	.zod(managedWebActionOutputSchema, "restartManagedWeb")
	.create()
	.path("/platform/managed-web/restart")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(managedWebActionOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Set (or clear with null) the custom public origin. Traefik routes it to the
 *  web; the app restarts with the new origin in its env. */
export const setManagedWebOriginContract = standard
	.zod(setManagedWebOriginOutputSchema, "setManagedWebOrigin")
	.create()
	.path("/platform/managed-web/origin")
	.input((b) => b.body(setManagedWebOriginInputSchema))
	.output((b) => b.body(setManagedWebOriginOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Provision the web app's own Cloudflare tunnel: create + CNAME, ingress →
 *  Traefik (web:80), persist identity, restart the app with the new origin. */
export const enableManagedWebTunnelContract = standard
	.zod(enableManagedWebTunnelOutputSchema, "enableManagedWebTunnel")
	.create()
	.path("/platform/managed-web/tunnel/enable")
	.input((b) => b.body(enableManagedWebTunnelInputSchema))
	.output((b) => b.body(enableManagedWebTunnelOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();

/** Remove the web app's own tunnel (delete tunnel + CNAME, restart the app). */
export const disableManagedWebTunnelContract = standard
	.zod(managedWebActionOutputSchema, "disableManagedWebTunnel")
	.create()
	.path("/platform/managed-web/tunnel/disable")
	.input((b) => b.body(z.object({})))
	.output((b) => b.body(managedWebActionOutputSchema))
	.errors((e) => [...standardDomainErrorContracts(e)])
	.build();
