import { NotFoundError } from "@deployer/errors";
import { Effect } from "effect";
import { guard } from "@project/core/effect/attempt";
import { ProjectStore } from "../repositories/project.repository";
import { projectRules, type ProjectAccess } from "../domain/project.entity";

/**
 * Load a project and prove the caller may act on it at `access` level.
 *
 * ── WHY THIS IS A LOOKUP AND NOT A ROLE LIST ────────────────────────────
 * The services used to spell `["owner", "admin"]` (or worse) at every call
 * site. `admin` is not a project role — the permission builder defines
 * `maintainer` — so the list matched nobody but the owner. The policy now lives
 * once, in `projectRules`, and this function is the only place that has to load
 * the rows to apply it.
 */
export function assertProjectAccess(projectId: string, userId: string, access: ProjectAccess) {
	return Effect.gen(function* () {
		const projects = yield* ProjectStore;
		const project = yield* projects.findById(projectId);
		if (!project) {
			return yield* Effect.fail(new NotFoundError("Project", projectId));
		}

		// The owner is the owner by virtue of the ROW, so a missing collaborator
		// record must not read as "no access" for them.
		const collaborator =
			project.ownerId === userId
				? null
				: yield* projects.findCollaboratorByUserAndProject(userId, projectId);

		yield* guard(() => projectRules.assertAccess(project, userId, collaborator, access));
		return project;
	});
}
