import type { ScreenReadService } from "../services/screen-read.service";
// Derived from the reads themselves rather than re-declared: the entity schemas are
// the contract's, and a second local copy would drift the moment a field is added.
export type ProjectRow = Awaited<ReturnType<ScreenReadService["listProjects"]>>["data"][number];
export type ServiceRow = Awaited<ReturnType<ScreenReadService["listProjectServices"]>>["data"][number];
export type DeploymentRow = Awaited<ReturnType<ScreenReadService["listDeployments"]>>["data"][number];

/** A project plus its roll-up, which no single service holds. */
export interface ProjectOverview {
	project: ProjectRow;
	serviceCount: number;
	deploymentCount: number;
	lastDeployedAt: string | null;
	healthRatio: number | null;
}

/** A service plus the deployment facts a project row shows beside it. */
export interface ServiceWithStatus {
	service: ServiceRow;
	lastDeploymentStatus: string | null;
	lastDeployedAt: string | null;
	primaryDomain: string | null;
}
