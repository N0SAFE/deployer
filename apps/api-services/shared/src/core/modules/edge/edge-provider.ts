/**
 * EdgeProvider — the plugin contract for the PUBLIC lane.
 *
 * The public lane is "reach Traefik's `public` entrypoint from the internet". HOW
 * is the provider's business: a tunnel whose connectors dial out, inbound ports on
 * the nodes, a relay on a VPS the operator owns… Everything around it is generic
 * and never names a provider:
 *
 *   IngressEdgeService           validates the lane, calls provision/teardown, shows status
 *   EdgeConnectorSupervisor      runs whatever `connector()` returns as a swarm service
 *   TraefikSupervisor            publishes whatever `ingress().publishedPorts` asks for
 *   EdgeDnsService               converges whatever `dnsRecords()` returns
 *
 * ── ADDING A PROVIDER ───────────────────────────────────────────────────────
 * Implement this interface in an @Injectable and register it from its constructor:
 *
 *   constructor(registry: EdgeProviderRegistry, …) { registry.register(this) }
 *
 * then add the class to any module's providers. Nest instantiates every provider
 * before any lifecycle hook runs, so registering from the constructor guarantees
 * the provider is known before the first supervisor sweep. Nothing else changes:
 * the web renders the provider from its `descriptor`.
 *
 * Providers keep their own replicated state through `EdgeStateStore` (one cluster
 * setting per provider) — never in a node-local store: the API can be rescheduled
 * to any node and must find the edge where it left it.
 */

import type {
	EdgeProviderDescriptor,
	EdgeStatus,
	PublicJoinPath,
	PublicLane,
} from "@deployer/contracts-entities/entities/ingress/index";

/** What a provider may need to know about each node. */
export interface EdgeNodeFacts {
	nodeId: string;
	/** The operator-declared public address of the node, if any. */
	publicAddress: string | null;
	addressKind: "ip" | "hostname" | null;
}

export interface EdgeContext {
	lane: PublicLane;
	/** Traefik's `public` entrypoint on the platform overlay — where every public request goes. */
	ingressTarget: string;
	nodes: readonly EdgeNodeFacts[];
	/** Name for resources created on the provider side; unique per stack, stable across retries. */
	resourceName: string;
}

/** A host port Traefik must publish on every node, and the entrypoint behind it. */
export interface EdgePublishedPort {
	published: number;
	entrypoint: "public" | "public-tls";
}

export interface EdgeIngressPlan {
	/** Empty for an edge that reaches Traefik over the overlay (every tunnel). */
	publishedPorts: readonly EdgePublishedPort[];
	/**
	 * Who serves HTTPS for public routes:
	 *   edge   the provider terminates TLS; Traefik serves plain HTTP behind it
	 *   acme   Traefik obtains certificates on `public-tls`
	 *   none   plain HTTP
	 */
	tls: "edge" | "acme" | "none";
}

/** A process the cluster must run for the edge (a tunnel connector). */
export interface EdgeConnectorSpec {
	image: string;
	/** `KEY=value`. Credentials go here, never in argv (readable via `docker inspect`). */
	env: string[];
	command: string[];
	args: string[];
	replicas: number;
}

/** A record set the public lane needs; converged to exactly `contents`. */
export interface EdgeDnsRecord {
	name: string;
	type: "A" | "CNAME";
	contents: string[];
	proxied: boolean;
	/** DNS account to try first (the one the tunnel lives on), else any account owning the zone. */
	preferredAccountId: string | null;
}

export interface EdgeProvider {
	readonly descriptor: EdgeProviderDescriptor;

	/** Static: how Traefik must be exposed for this lane. Pure — read on every supervisor sweep. */
	ingress(lane: PublicLane): EdgeIngressPlan;

	/**
	 * Provider-specific validation beyond the descriptor's fields (which the registry
	 * already checked). Throw a `BadRequestException` with the reason.
	 */
	validate?(lane: PublicLane): void;

	/** Make the provider side exist and route `*.<domain>` to `ctx.ingressTarget`. Idempotent. */
	provision(ctx: EdgeContext): Promise<void>;

	/** Remove everything the provider created, and its state. Idempotent. */
	teardown(): Promise<void>;

	/** The process the cluster must run, or null when this edge needs none (or is not provisioned). */
	connector(ctx: EdgeContext): Promise<EdgeConnectorSpec | null>;

	dnsRecords(ctx: EdgeContext): Promise<EdgeDnsRecord[]>;

	status(ctx: EdgeContext): Promise<EdgeStatus>;

	/** Whether, and how, a node that is not a member yet can join through this edge. */
	joinPath(ctx: EdgeContext, status: EdgeStatus): PublicJoinPath;
}
