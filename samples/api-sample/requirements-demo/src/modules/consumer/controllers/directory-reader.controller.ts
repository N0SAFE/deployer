import { Controller } from "@nestjs/common";
import { Implement } from "@orpc/nest";

import { procedure } from "../../../effect";

import { consumerContract } from "../contracts/consumer.contract";

import { MeshDirectory } from "../../mesh/services/directory.service";

/**
 * A controller in a module that only *imports* the mesh.
 *
 * `MeshDirectory` is visible because `MeshDomainModule` exports it — and `MeshRelay` is not, because it does not. Both
 * facts are enforced by the type audit and by the scoped runtime context.
 */
@Controller()
export class DirectoryReaderController {
	@Implement(consumerContract.directory)
	directory() {
		return procedure(consumerContract.directory).effect(function* () {
			const directory = yield* MeshDirectory;
			return { replicas: [...(yield* directory.snapshot())] };
		});
	}
}
