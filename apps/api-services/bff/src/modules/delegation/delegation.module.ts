/**
 * The delegated service surface, as ONE module.
 *
 * ── WHY A SINGLE MODULE AND NOT EIGHTEEN ────────────────────────────────────
 * The controllers are generated and share one dependency (`ServiceClientRegistry`,
 * which is `@Global`). Eighteen modules would be eighteen identical `imports: []`
 * declarations whose only content is a controller list — structure that carries no
 * information and that a reader has to traverse to learn nothing.
 *
 * ── WHY THE CONTROLLERS ARE LISTED EXPLICITLY ───────────────────────────────
 * NestJS has no directory-scanning registration, and a dynamic require would hide the
 * surface from both the type checker and a reader. The list is the enumeration, and
 * `scripts/gen-bff-delegation.py` is what keeps it in step with the contracts: adding a
 * namespace there without adding it here means its procedures 404 — a loud, immediate
 * failure rather than a silent one.
 */

import { Module } from "@nestjs/common";

import { AnalyticsDelegationController } from "./generated/analytics.delegation";
import { ClusterDelegationController } from "./generated/cluster.delegation";
import { DeploymentDelegationController } from "./generated/deployment.delegation";
import { DockerDelegationController } from "./generated/docker.delegation";
import { DomainDelegationController } from "./generated/domain.delegation";
import { HealthDelegationController } from "./generated/health.delegation";
import { MeshDelegationController } from "./generated/mesh.delegation";
import { MeshResourceDelegationController } from "./generated/meshResource.delegation";
import { NodesDelegationController } from "./generated/nodes.delegation";
import { PlatformDelegationController } from "./generated/platform.delegation";
import { ProjectDelegationController } from "./generated/project.delegation";
import { ProviderSchemaDelegationController } from "./generated/providerSchema.delegation";
import { ProvidersDelegationController } from "./generated/providers.delegation";
import { PushDelegationController } from "./generated/push.delegation";
import { ReachabilityDelegationController } from "./generated/reachability.delegation";
import { ServiceDelegationController } from "./generated/service.delegation";
import { ServicePreviewTopologyDelegationController } from "./generated/servicePreviewTopology.delegation";
import { UserDelegationController } from "./generated/user.delegation";

@Module({
	controllers: [
		AnalyticsDelegationController,
		ClusterDelegationController,
		DeploymentDelegationController,
		DockerDelegationController,
		DomainDelegationController,
		HealthDelegationController,
		MeshDelegationController,
		MeshResourceDelegationController,
		NodesDelegationController,
		PlatformDelegationController,
		ProjectDelegationController,
		ProviderSchemaDelegationController,
		ProvidersDelegationController,
		PushDelegationController,
		ReachabilityDelegationController,
		ServiceDelegationController,
		ServicePreviewTopologyDelegationController,
		UserDelegationController,
	],
})
export class DelegationModule {}
