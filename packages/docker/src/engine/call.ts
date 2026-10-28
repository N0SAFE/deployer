import { Effect } from "effect";

import { engineMessage, isNotFound } from "../errors/classify";
import { DockerNotFound, DockerUnavailable } from "../errors/errors";

/**
 * Runs one engine call. A 404 becomes `DockerNotFound` naming `resource` (when the caller says what
 * it asked for); anything else is `DockerUnavailable` saying which `operation` failed and why.
 */
export function engineCall<A>(
	operation: string,
	run: () => Promise<A>,
	resource?: string,
): Effect.Effect<A, DockerNotFound | DockerUnavailable> {
	return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
		Effect.mapError((cause) =>
			resource !== undefined && isNotFound(cause)
				? new DockerNotFound({ resource, cause })
				: new DockerUnavailable({ reason: `Failed to ${operation}: ${engineMessage(cause)}`, cause }),
		),
	);
}
