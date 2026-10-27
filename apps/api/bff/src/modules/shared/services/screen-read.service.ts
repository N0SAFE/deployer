import { IdentityClient } from "@/clients/identity/identity.client";
import { ProjectClient } from "@/clients/project/project.client";
import { RuntimeClient } from "@/clients/runtime/runtime.client";
import { Injectable } from "@nestjs/common";

/** A per-source outcome, so one dead dependency degrades instead of failing. */
export type Section = {
	name: string;
	ok: boolean;
	reason?: string;
}

/**
 * Read `fn`, or `null` when it fails, recording the outcome for the payload.
 *
 * ── WHY PARTIAL FAILURE MUST NOT BE TOTAL ───────────────────────────────────
 * The dashboard reads four sources. If analytics is down and this rethrows, the
 * operator sees an error page and learns NOTHING about the three that answered.
 * Recording the failure per source keeps the other three usable and names the one
 * that is not — the only actionable part of the answer.
 *
 * ── WHY `null` AND NOT A DEFAULT ────────────────────────────────────────────
 * A metric that is unavailable and a metric that is genuinely zero are different
 * facts. Defaulting to `0` renders a healthy-looking dashboard for a service that
 * is down.
 */
export async function optional<T>(
	sections: Section[],
	name: string,
	fn: () => Promise<T>,
): Promise<T | null> {
	try {
		const value = await fn();
		sections.push({ name, ok: true });
		return value;
	} catch (error: unknown) {
		sections.push({
			name,
			ok: false,
			reason: error instanceof Error ? error.message : String(error),
		});
		return null;
	}
}

/**
 * The service reads every screen composes, in one place.
 *
 * ── WHY A SERVICE AND NOT FOUR LINES IN EACH ORCHESTRATOR ───────────────────
 * The dashboard, the projects list, the project detail and the fleet overview all
 * read the same four things. The ARGUMENT SHAPES are why this is central: the query
 * builder expects `{ query: { limit, offset, filter, sortBy } }` with filters shaped
 * `{ field: { operator, value } }`. That is easy to get subtly wrong in a way that
 * still compiles and silently returns UNFILTERED rows, so it is written once here.
 */
@Injectable()
export class ScreenReadService {
	constructor(
		private readonly identity: IdentityClient,
		private readonly projects: ProjectClient,
		private readonly runtime: RuntimeClient,
	) {}

	/** Projects, paginated. `meta` carries `total` and `hasMore`. */
	listProjects(input: { limit: number; offset: number; search?: string }) {
		return this.projects.raw.project.list({
			query: {
				limit: input.limit,
				offset: input.offset,
				...(input.search === undefined
					? {}
					: { filter: { name: { operator: "ilike" as const, value: input.search } } }),
			},
		});
	}

	/** One project with its stats, or null when it does not exist. */
	findProject(projectId: string) {
		return this.projects.raw.project.findById({ params: { id: projectId } });
	}

	/** Every service of a project. `service` is its own router (`serviceContract.crud.list`). */
	listProjectServices(projectId: string) {
		return this.projects.raw.service.crud.list({
			query: {
				limit: 100,
				offset: 0,
				filter: { projectId: { operator: "eq" as const, value: projectId } },
			},
		});
	}

	/** One service by id. */
	findService(serviceId: string) {
		return this.projects.raw.service.crud.findById({
			params: { id: serviceId },
		});
	}

	/** Deployments of a project or a service, newest first. */
	listDeployments(filter: { projectId?: string; serviceId?: string }, limit: number) {
		const field = filter.projectId !== undefined ? "projectId" : "serviceId";
		const value = filter.projectId ?? filter.serviceId;

		return this.runtime.raw.deployment.list({
			query: {
				limit,
				offset: 0,
				...(value === undefined
					? {}
					: { filter: { [field]: { operator: "eq" as const, value } } }),
			},
		});
	}

	/** The domains attached to a project. */
	listProjectDomains(projectId: string) {
		return this.projects.listProjectDomains({
			params: { projectId },
		});
	}

	/** The domains attached to one service, which is where its hostname lives. */
	listServiceDomains(serviceId: string) {
		return this.projects.listServiceDomains({
			params: { serviceId },
		});
	}

	/** The operator's own record, for the shell and the dashboard header. */
	findOperator(userId: string) {
		return this.identity
			.findById({ params: { id: userId } });
	}
}
