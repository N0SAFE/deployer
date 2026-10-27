/* eslint-disable @typescript-eslint/no-unsafe-declaration-merging -- the interface/class merge below is how the flattened procedures get their types */
import { Injectable } from "@nestjs/common";
import type { ContractRouterClient } from "@orpc/contract";

import { BaseClient, type FlatLeaves } from "@deployer/nest-service-client";
import { projectServiceContract } from "@deployer/project-contracts";
import { ServiceClientRegistry } from "../service-registry";

/**
 * The project service, with its procedure names callable at the ROOT.
 *
 * `listProjectDomains(...)` is reachable directly, and the namespaced paths stay
 * available through `raw` (`raw.project.getCollaborators(...)`).
 *
 * ── WHY SOME NAMES ARE OMITTED FROM THE ROOT ────────────────────────────────
 * `projectServiceContract` has a `service` router whose `crud` exposes the SAME
 * procedure names as the project router itself — `list`, `findById`, and a `crud`
 * key of its own. Flattening both produces incompatible members under one name, and
 * TypeScript refuses a merge where one name means two different things.
 *
 * Omitting those three from the root alias is the honest resolution rather than
 * picking a winner: a silent winner would run the WRONG procedure — reading a
 * project where the caller asked for a service — with no diagnostic. They stay
 * reachable by their unambiguous namespaced path:
 *
 *     this.projects.raw.project.findById({ params })          // a project
 *     this.projects.raw.service.crud.findById({ params })     // a service
 *
 * Everything that does NOT collide keeps its short form.
 */
// An interface, not a type alias, ON PURPOSE: only an interface merges with the class below, which is how
// the flattened procedures reach the class's type. Do not turn it into a `type` alias: the merge
// breaks with `Duplicate identifier`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ProjectClient
	extends Omit<
		FlatLeaves<ContractRouterClient<typeof projectServiceContract>>,
		"crud" | "list" | "findById"
	> {}

@Injectable()
export class ProjectClient extends BaseClient<typeof projectServiceContract> {
	constructor(binder: ServiceClientRegistry) {
		super(binder, { service: "project", contract: projectServiceContract });
	}
}
