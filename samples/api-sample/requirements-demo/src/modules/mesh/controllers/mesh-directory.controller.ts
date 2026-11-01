import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";
import { Effect } from "effect";

import { procedure } from "../../../effect";

import { directoryContract } from "../contracts/mesh.contract";
import { MeshDirectory } from "../services/directory.service";

/**
 * The service directory, served to the services on this node.
 *
 * There is no wiring line: `.effect()` infers the requirements from the body and returns them in the procedure's type,
 * which is what the module audits.
 */
@Controller()
export class MeshDirectoryController {
	@Implement(directoryContract.register)
	register() {
		return procedure(directoryContract.register)
			.effect(function* ({ input }) {
				const directory = yield* MeshDirectory;
				return yield* directory.register(input);
			});
	}

	@Implement(directoryContract.unregister)
	unregister() {
		return procedure(directoryContract.unregister)
			.effect(function* ({ input }) {
				const directory = yield* MeshDirectory;
				return { removed: yield* directory.unregister(input.replicaId) };
			});
	}

	@Implement(directoryContract.resolve)
	resolve() {
		return procedure(directoryContract.resolve)
			.effect(function* ({ input, errors }) {
				const directory = yield* MeshDirectory;
				return yield* directory.resolve(input).pipe(
					Effect.catchTag("MeshNoReplica", ({ service }) =>
						Effect.fail(errors.NOT_FOUND({ data: { service } })),
					),
				);
			});
	}

	@Implement(directoryContract.snapshot)
	snapshot() {
		return procedure(directoryContract.snapshot)
			.effect(function* () {
				const directory = yield* MeshDirectory;
				return { replicas: [...(yield* directory.snapshot())] };
			});
	}
}
