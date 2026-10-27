import type { ProjectAccessService } from "@deployer/shared/core/modules/project/services/project-access.service";
import { Context } from "effect";

/** Effect view of the shared project-access checks. */
export type ProjectAccessShape = Pick<ProjectAccessService, "assertProjectAccess">;

export class ProjectAccess extends Context.Service<ProjectAccess, ProjectAccessShape>()(
	"project/ProjectAccess",
) {}
