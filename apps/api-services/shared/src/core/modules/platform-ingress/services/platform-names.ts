/**
 * platform-names.ts — shared PLATFORM identity constants (one source of truth
 * for container names/labels used across the platform-ingress helpers and the
 * supervisors that consume them).
 *
 * Lives in the helper layer so supervisors import FROM it (one-way boundary:
 * platform-ingress helpers never import supervisors).
 */

/** Base container name of the API-supervised managed web app (per-prefix
 *  names append `-<prefix>`). Shared by the managed-web supervisor (spawns
 *  it), the Traefik supervisor (web-route backend) and the failover proxy
 *  (default web forward target). */
export const MANAGED_WEB_CONTAINER_BASE_NAME = "deployer-managed-web";

/** Base container name of the platform Traefik (per-prefix names append
 *  `-<prefix>`). The single entry point for ALL public traffic: tunnels and
 *  domains resolve here, and Traefik routes by Host (global domain → API,
 *  deployment domain → its container, web domain → the web app). */
export const PLATFORM_TRAEFIK_BASE_NAME = "deployer-traefik";

/**
 * Traefik container name on the platform network at `DEPLOYER_PREFIX`.
 * Tunnel ingress rules target this (web:80) so the tunnel hostname enters
 * Traefik, which then routes by Host — the node's global address → API,
 * the web app's own address → the web container.
 */
export function platformTraefikContainerName(prefix?: string | null): string {
	return prefix === "" || prefix === undefined || prefix === null
		? PLATFORM_TRAEFIK_BASE_NAME
		: `${PLATFORM_TRAEFIK_BASE_NAME}-${prefix}`;
}

/** Web runtime port INSIDE the container (the web runtime image serves 3000,
 *  never published to the host). */
export const PLATFORM_WEB_INTERNAL_PORT = 3000;
/** Base name of the API swarm service (setup creates it with this name). */
export const PLATFORM_API_BASE_NAME = "deployer-api";

/**
 * The API's swarm SERVICE name — also its overlay alias.
 *
 * This is the name the ingress dials for its routes: it is stable across task
 * reschedules and shared by every API replica, whereas a task's container name
 * changes on every reschedule and differs per replica (two replicas each writing
 * their own name into Traefik's arguments would roll the ingress forever).
 */
export function platformApiServiceName(prefix?: string | null): string {
	return prefix === "" || prefix === undefined || prefix === null ? PLATFORM_API_BASE_NAME : `${PLATFORM_API_BASE_NAME}-${prefix}`;
}
