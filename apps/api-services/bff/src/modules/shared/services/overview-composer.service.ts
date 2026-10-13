import { Injectable } from "@nestjs/common";

import { optional, ScreenReadService, type Section } from "./screen-read.service";
import type { Stat } from "../screen-shapes";
import { ServiceNotFoundError } from "../errors/service-not-found.error";
import type { DeploymentRow, ProjectOverview, ProjectRow, ServiceRow, ServiceWithStatus } from "../types/project-overview";

/** The labels the stat strip renders, so the wording has a single owner. */
const STAT_LABELS: Record<string, string> = {
	projects: "Projects",
	services: "Services",
	deployments: "Deployments",
	succeeded: "Succeeded",
	failed: "Failed",
	domains: "Domains",
};

/**
 * Turns reads from several services into the shapes screens render.
 *
 * ── WHAT THIS CLASS IS NOT ──────────────────────────────────────────────────
 * It is not a router and holds no routes: the controller owns the HTTP surface,
 * this owns the JOIN. Splitting them is what lets one composition serve two calls —
 * the dashboard embeds project overviews, the projects list returns a page of them —
 * with ONE implementation of "what a project overview is".
 *
 * ── WHY EVERY JOIN HAPPENS IN MEMORY ────────────────────────────────────────
 * The services are separate processes with separate databases, so there is no join
 * available ACROSS them: composing means reading each side and matching in the BFF.
 * That is the cost of the boundary — and the reason the fan-outs below are issued in
 * PARALLEL and scoped to the page rather than per row.
 */
@Injectable()
export class OverviewComposerService {
	constructor(private readonly reads: ScreenReadService) {}

	/**
	 * One page of projects, each with its service and deployment roll-up.
	 *
	 * ── WHY THE ROLL-UPS ARE ONE PARALLEL FAN-OUT OVER THE PAGE ─────────────
	 * Each project needs its services and its deployments. Doing that sequentially
	 * per project is 2 x page-size round trips, serialized — the N+1 that makes a
	 * list slow in exactly the case (a full page) where it is most visible. Issuing
	 * them together bounds the cost to roughly one round trip's latency.
	 */
	async projectOverviews(input: {
		limit: number;
		offset: number;
		search?: string;
	}): Promise<{ items: ProjectOverview[]; total: number; hasMore: boolean; sections: Section[] }> {
		const page = await this.reads.listProjects(input);
		if (page.data.length === 0) {
			return {
				items: [],
				total: page.meta.total,
				hasMore: page.meta.hasMore,
				sections: [{ name: "projects", ok: true }],
			};
		}

		// The projects leg succeeded (we have a page). The two legs per project are
		// recorded INSIDE the roll-up, which returns a partial row instead of throwing;
		// one unreadable project must not blank the list.
		const sections: Section[] = [{ name: "projects", ok: true }];
		const items = await Promise.all(page.data.map((project) => this.rollUpProject(project, sections)));

		return { items, total: page.meta.total, hasMore: page.meta.hasMore, sections };
	}

	/**
	 * One project's roll-up: its services, its deployments, and the ratio between them.
	 *
	 * ── WHY `sections` IS ACCUMULATED HERE AND NOT PER PROJECT ──────────────
	 * Twenty projects are not twenty sources. Reporting a section per row would turn
	 * ONE dead dependency into twenty failures in the payload, which reads as a
	 * platform-wide outage rather than a single unreadable service.
	 */
	private async rollUpProject(project: ProjectRow, sections: Section[]): Promise<ProjectOverview> {
		const [services, deployments] = await Promise.all([
			settle("services", sections, () => this.reads.listProjectServices(project.id)),
			settle("deployments", sections, () =>
				this.reads.listDeployments({ projectId: project.id }, 50),
			),
		]);

		const rows = deployments?.data ?? [];
		const succeeded = rows.filter((deployment) => deployment.status === "success").length;
		// The list sorts `createdAt desc`, so the first row IS the latest. Reading it
		// rather than sorting again keeps one definition of "latest".
		const latest = rows[0] ?? null;

		return {
			project,
			serviceCount: services?.meta.total ?? 0,
			// `meta.total` is the true count; `rows.length` is the page. Using the total
			// is what makes the card say "42 deployments" rather than "50".
			deploymentCount: deployments?.meta.total ?? rows.length,
			lastDeployedAt: latest?.createdAt ?? null,
			healthRatio: rows.length === 0 ? null : succeeded / rows.length,
		};
	}

	/**
	 * A project's services, each with its latest deployment and primary domain.
	 *
	 * ── WHY THE DOMAIN IS READ PER SERVICE, NOT PER PROJECT ─────────────────
	 * The detail screen shows the hostname EACH service answers on. A service domain
	 * is a different resource from a project domain (the service inherits a subdomain
	 * of the project's zone), so the project's own domain list cannot answer this —
	 * the service's own is the only correct source.
	 */
	async serviceRollUps(projectId: string): Promise<{
		services: ServiceWithStatus[];
		domains: string[];
		sections: Section[];
	}> {
		const sections: Section[] = [];

		const [servicesPage, domains] = await Promise.all([
			settle("services", sections, () => this.reads.listProjectServices(projectId)),
			settle("domains", sections, () => this.reads.listProjectDomains(projectId)),
		]);

		const services = await Promise.all(
			(servicesPage?.data ?? []).map((service) => this.rollUpService(service)),
		);

		return { services, domains: (domains ?? []).map((domain) => domain.domain), sections };
	}

	/** One service's status: its latest deployment and its hostname. */
	private async rollUpService(service: ServiceRow): Promise<ServiceWithStatus> {
		// Discarded: a service row that could not be enriched is still a real service and
		// must appear, so this reports the gaps as nulls instead of failing the screen.
		const ignored: Section[] = [];

		const [deployments, serviceDomains] = await Promise.all([
			settle("deployments", ignored, () => this.reads.listDeployments({ serviceId: service.id }, 1)),
			settle("serviceDomains", ignored, () => this.reads.listServiceDomains(service.id)),
		]);

		const latest = deployments?.data[0] ?? null;
		// The primary mapping wins; otherwise the first is the best available answer, which
		// beats showing nothing for a service that demonstrably has a hostname.
		const primary =
			serviceDomains?.find((mapping) => mapping.isPrimary) ?? serviceDomains?.[0] ?? null;

		return {
			service,
			lastDeploymentStatus: latest?.status ?? null,
			lastDeployedAt: latest?.createdAt ?? null,
			primaryDomain: primary?.fullUrl ?? null,
		};
	}

	/**
	 * One service's detail: the service, its latest and recent deployments, its domain.
	 *
	 * `NonNullable<...>` because the method THROWS on a missing service (below), so a
	 * caller that gets a result never has to handle null. `crud.findById` answers null
	 * as its own "not found" signal; converting it here is what makes the contract's
	 * non-null `service` field honest rather than a cast.
	 */
	async serviceDetail(serviceId: string): Promise<{
		service: NonNullable<Awaited<ReturnType<ScreenReadService["findService"]>>>;
		projectId: string | null;
		lastDeployment: DeploymentRow | null;
		recentDeployments: DeploymentRow[];
		primaryDomain: string | null;
		stats: Stat[];
		sections: Section[];
	}> {
		const sections: Section[] = [];

		const service = await this.reads.findService(serviceId);
		if (service === null) {
			// The service's findById answers null rather than 404, so the BFF decides. A
			// missing service is a 404 by the time it reaches the front, but that mapping
			// belongs to the controller — a data-access method returning null is honest.
			throw new ServiceNotFoundError(serviceId);
		}

		const [deployments, serviceDomains] = await Promise.all([
			settle("deployments", sections, () => this.reads.listDeployments({ serviceId }, 10)),
			settle("serviceDomains", sections, () => this.reads.listServiceDomains(serviceId)),
		]);

		const rows = deployments?.data ?? [];
		const primary =
			serviceDomains?.find((mapping) => mapping.isPrimary) ?? serviceDomains?.[0] ?? null;

		return {
			service,
			projectId: service.projectId,
			lastDeployment: rows[0] ?? null,
			recentDeployments: rows,
			primaryDomain: primary?.fullUrl ?? null,
			stats: this.buildStats({
				deployments: rows.length,
				succeeded: rows.filter((deployment) => deployment.status === "success").length,
				failed: rows.filter((deployment) => deployment.status === "failed").length,
			}),
			sections,
		};
	}

	/**
	 * The counts a stat strip renders.
	 *
	 * Built from values the caller ALREADY read rather than re-reading them: the caller
	 * had to fetch them to compose the rest of the screen, and a second read would be a
	 * round trip for a number already in hand.
	 */
	buildStats(counts: Record<string, number>): Stat[] {
		return Object.entries(counts).map(([key, value]) => ({
			key,
			label: STAT_LABELS[key] ?? key,
			value,
		}));
	}
}

/**
 * `optional`, but recording ONE section per source name.
 *
 * ── WHY THE TYPE IS TAKEN FROM THE CALLBACK ─────────────────────────────────
 * The return type is `Awaited<ReturnType<F>> | null` rather than a plain `T`. A bare
 * generic collapses to its constraint at the call site (`{}`, then `object`) because
 * nothing anchors it — `Promise.all` sees two callbacks whose types are inferred
 * together and gives up. Reading the type OFF the callback keeps each result exactly
 * as the client typed it.
 *
 * ── WHY DEDUPED ─────────────────────────────────────────────────────────────
 * A page of 20 projects reads `services` 20 times. Recording each would report the
 * same dependency as 20 sections, turning one dead service into what reads like a
 * platform-wide outage. The first outcome per name is the fact; the rest is noise.
 *
 * ── WHY THE FIRST OUTCOME AND NOT THE LAST ──────────────────────────────────
 * Sources are read in parallel, so "the last one" is whichever resolved last — not a
 * fact about the platform. The first is stable, and it preserves a failure that a
 * later success would otherwise erase.
 */
async function settle<F extends () => Promise<unknown>>(
	name: string,
	sections: Section[],
	fn: F,
): Promise<Awaited<ReturnType<F>> | null> {
	// A scratch list, so `optional`'s bookkeeping never touches the shared one. Merging
	// afterwards is what makes dedupe a decision THIS function makes, rather than
	// something it undoes from a helper that recorded unconditionally.
	const scratch: Section[] = [];
	const value = await optional(scratch, name, fn as () => Promise<unknown>);

	const outcome = scratch[0];
	if (outcome !== undefined && !sections.some((section) => section.name === name)) {
		sections.push(outcome);
	}

	return value as Awaited<ReturnType<F>> | null;
}
