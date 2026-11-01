import { createModuleContext, effectHostProvider } from "@deployer/nest-effect";
import { nodeAgentContract } from "@deployer/node-agent-contracts";
import { MeshTransportModule } from "@deployer/nest-mesh";

import { MeshTransportService } from "./mesh-transport.service";
import { SERVICE_DOOR_PROCEDURES } from "./service-door";

/**
 * The agent's transport, as a module: the resolver is told which contract the doors must cover and what the service door
 * may serve, and the service owns the websocket, the two unix sockets and the loops. The intervals come from
 * `ConfigService`, so a test sets a fast environment instead of passing options.
 */
export class NodeAgentTransportModule extends createModuleContext({
  imports: [MeshTransportModule.forRoot({ contract: nodeAgentContract, serviceProcedures: SERVICE_DOOR_PROCEDURES })],
  providers: [effectHostProvider(), MeshTransportService],
  exports: [MeshTransportService],
}) {}
