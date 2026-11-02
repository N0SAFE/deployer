import { Context } from "effect";

import type { ServiceClient } from "@deployer/shared/server";

/** Effect view of the service client: the clients that call a sibling service as the system. */
export type SystemActorClientsShape = Pick<ServiceClient, "systemActorClientFor">;

export class SystemActorClients extends Context.Service<SystemActorClients, SystemActorClientsShape>()(
	"fleet/SystemActorClients",
) {}
