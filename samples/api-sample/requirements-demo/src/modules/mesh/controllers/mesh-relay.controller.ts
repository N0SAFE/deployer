import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { procedure } from "../../../effect";

import { relayContract } from "../contracts/mesh.contract";
import { MeshRelay } from "../services/relay.service";

/** Relays a call to a replica. What it uses, it yields; what it yields, the module audits. */
@Controller()
export class MeshRelayController {
	@Implement(relayContract.forward)
	forward() {
		return procedure(relayContract.forward)
			.effect(function* ({ input }) {
				const relay = yield* MeshRelay;
				return yield* relay.forward(input.replicaId);
			});
	}
}
