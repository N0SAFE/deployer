import { oc } from "@orpc/contract";
import {
	registerAppInstanceContract,
	heartbeatAppInstanceContract,
	listAppInstancesContract,
	revokeAppInstanceContract,
	getIngressStateContract,
	setEntryPortContract,
	restartTraefikContract,
	setGlobalNetworkContract,
	getManagedWebStateContract,
	toggleManagedWebContract,
	restartManagedWebContract,
	setManagedWebOriginContract,
	enableManagedWebTunnelContract,
	disableManagedWebTunnelContract,
	registerAppInstanceInputSchema,
	registerAppInstanceOutputSchema,
	heartbeatAppInstanceInputSchema,
	heartbeatAppInstanceOutputSchema,
	appInstanceTokenHeadersSchema,
	listAppInstancesInputSchema,
	listAppInstancesOutputSchema,
	revokeAppInstanceInputSchema,
	revokeAppInstanceOutputSchema,
	appInstanceEntityOutputSchema,
	ingressStateOutputSchema,
	ingressEntrySchema,
	ingressTraefikStateSchema,
	ingressGlobalNetworkSchema,
	setEntryPortInputSchema,
	setGlobalNetworkInputSchema,
	setGlobalNetworkOutputSchema,
	managedWebStateOutputSchema,
	managedWebTunnelIdentitySchema,
	setManagedWebOriginInputSchema,
	setManagedWebOriginOutputSchema,
	enableManagedWebTunnelInputSchema,
	enableManagedWebTunnelOutputSchema,
	managedWebActionOutputSchema,
} from "./platform.contract";

export * from "./platform.contract";

/**
 * Platform contract group — api-centric deployment surface.
 * Ops carry their full paths (no prefix here to avoid duplication).
 */
export const platformContract = oc.router({
	registerAppInstance: registerAppInstanceContract,
	heartbeatAppInstance: heartbeatAppInstanceContract,
	listAppInstances: listAppInstancesContract,
	revokeAppInstance: revokeAppInstanceContract,
	getIngressState: getIngressStateContract,
	setEntryPort: setEntryPortContract,
	restartTraefik: restartTraefikContract,
	setGlobalNetwork: setGlobalNetworkContract,
	getManagedWebState: getManagedWebStateContract,
	toggleManagedWeb: toggleManagedWebContract,
	restartManagedWeb: restartManagedWebContract,
	setManagedWebOrigin: setManagedWebOriginContract,
	enableManagedWebTunnel: enableManagedWebTunnelContract,
	disableManagedWebTunnel: disableManagedWebTunnelContract,
});

export type PlatformContract = typeof platformContract;
