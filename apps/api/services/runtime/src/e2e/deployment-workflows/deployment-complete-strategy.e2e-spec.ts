import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
// The app-local wrapper, not the raw harness: the harness REQUIRES
// `nest.rootModuleLoader` and lives in `shared`, where `@/app.module` resolves to
// nothing, so importing it directly throws
// `SharedApiRuntimeOptions.nest.rootModuleLoader is required` at boot.
import { useDescribeSharedApiRuntime, withDeploymentQueueWorkerDisabled } from "@/e2e/runtime";
import { TraefikService } from "@deployer/shared/core/modules/traefik/services/traefik.service";

import { DeploymentService } from "@/modules/deployment/services/deployment.service";

import {
	createDeploymentCompleteStrategyContext,
	type DeploymentCompleteStrategyContext,
} from "./support/deployment-complete-strategy-context";

/**
 * The deployment workflow's cross-domain seams.
 *
 * ── WHY THE PROJECT-CONFIG CASES ARE NOT HERE ──────────────────────────────
 * This suite used to open by creating a project and setting its deployment/security/
 * environment configuration. Those are the PROJECT service's rules, and once the domains
 * split into separate processes a single-service suite cannot exercise them honestly — it
 * would be asserting the project domain's behaviour from inside the runtime app.
 *
 * What remains is what THIS service actually does: take a seeded project and service,
 * trigger a deployment, and drive its queue job — plus the Traefik projection, which is core
 * infrastructure this app shares.
 */
describe("Deployment strategy e2e: service, traefik projection and the upload deployment flow", () => {
	// The worker is disabled for this suite: it claims and executes any job with a
	// `deploymentId` on the tick it is enqueued, and this suite asserts the enqueued
	// job's payload and then drives its lifecycle itself. Leaving it enabled is a
	// race for the job — which is why the assertion saw `claimed` where it expected
	// `queued`.
	const runtimeScope = useDescribeSharedApiRuntime(withDeploymentQueueWorkerDisabled());
	let context: DeploymentCompleteStrategyContext;
	let deployment: DeploymentService;
	let traefik: TraefikService;

	beforeAll(async () => {
		context = await createDeploymentCompleteStrategyContext(runtimeScope.getContext());
		deployment = runtimeScope.getContext().serviceMapper.get(DeploymentService);
		traefik = runtimeScope.getContext().serviceMapper.get(TraefikService);
	});

	it("projects a seeded service into a valid Traefik routing configuration", async () => {
		const project = await context.fixtures.project(context.ownerId, {
			baseDomain: "services.e2e.example.test",
		});
		const service = await context.fixtures.service(project.id, {
			name: `api-${randomUUID()}`,
			port: 3000,
		});

		const serviceConfig = await traefik.createServiceConfiguration(service.id, {
			domain: "services.e2e.example.test",
			subdomain: `svc-${service.id.slice(0, 8)}`,
			port: 3000,
			sslEnabled: true,
			sslProvider: "letsencrypt",
			pathPrefix: "/",
			healthCheck: { enabled: true, path: "/health" },
		});

		if (serviceConfig === null || serviceConfig === undefined) {
			throw new Error("Expected the Traefik service configuration to be created");
		}

		const validation = await traefik.validateConfiguration(serviceConfig.id);

		expect(service.projectId).toBe(project.id);
		// The fixture pins the upload source and the manual runner — the premise the
		// deployment case below depends on, asserted here so a fixture change fails loudly.
		expect(service.providerId).toBe("artifact-bundle");
		expect(serviceConfig.serviceId).toBe(service.id);
		expect(serviceConfig.fullDomain).toContain("services.e2e.example.test");
		expect(validation.isValid).toBe(true);
		expect(validation.errors).toHaveLength(0);
	});

	it("triggers an upload deployment and drives its queue job to completion", async () => {
		const project = await context.fixtures.project(context.ownerId, {
			baseDomain: "deploy.e2e.example.test",
		});
		const service = await context.fixtures.service(project.id, {
			name: `web-${randomUUID()}`,
			port: 8080,
		});

		const uploadId = `upload-${randomUUID()}`;
		const triggered = await deployment.triggerDeployment(
			{
				serviceId: service.id,
				environment: "preview",
				source: {
					sourceType: "upload",
					uploadId,
					uploadPath: "/tmp/e2e-upload/bundle.zip",
					fileName: "bundle.zip",
					fileSize: 1024,
					customData: {							// `uploadId` is required INSIDE `customData`, not only beside it:
							// `uploadSourceContextSchema` validates `customData.uploadId` and the
							// provider throws
							// `Upload source requires valid source with customData.uploadId`
							// when it is absent. The top-level field alone is not the source of
							// truth the provider reads.
							uploadId,						runtimeRunner: "dockerfile",
						containerImage: `ghcr.io/e2e/deploy-${service.id.slice(0, 8)}:latest`,
						runtimeRunnerOptions: {								// `runner` is the DISCRIMINANT: `runtimeRunnerOptionsSchema` is a
								// discriminated union on it, and the members are `.strict()`, so an
								// absent `runner` fails the parse and surfaces as the same generic
								// "customData.uploadId" message — which is why the message named a
								// field that was in fact present.
								runner: "dockerfile",							containerName: `ctr-${service.id.slice(0, 8)}`,
							networkMode: "bridge",
							healthCheckMaxRetries: 3,
							healthCheckRetryIntervalMs: 1000,
						},
					},
				},
			},
			context.ownerId,
			null,
		);

		expect(triggered.status).toBe("queued");

		const queueJobs = deployment.listQueueJobs({
			deploymentId: triggered.id,
			status: "queued",
			limit: 20,
			offset: 0,
		});

		const deployJob = queueJobs.items.find((job) => job.type === "deploy");
		if (deployJob === undefined) {
			throw new Error("Expected a queued deploy job for the triggered deployment");
		}

		// The job payload is the CONTRACT between this domain and its worker: it must carry
		// the resolved source, storage binding and runtime configuration, or the worker would
		// have to re-derive them — the divergence this assertion exists to catch.
		const payload = deployJob.payload.context as {
			sourceCheckout?: { provider?: string; uploadId?: string };
			storageBinding?: { storageType?: string; updateStrategy?: string };
			runtimeConfiguration?: { deployment?: { strategy?: string } };
		};

		expect(payload.sourceCheckout?.provider).toBe("upload");
		expect(payload.sourceCheckout?.uploadId).toBe(uploadId);
		expect(payload.storageBinding?.storageType).toBe("local");
		expect(payload.storageBinding?.updateStrategy).toBe("manual_update_button");
		expect(typeof payload.runtimeConfiguration?.deployment?.strategy).toBe("string");

		const claimed = await deployment.claimQueueJobByIdempotencyKey(
			`deploy:${triggered.id}:trigger`,
			{ workerId: context.workerId, types: ["deploy"], limit: 1, leaseDurationSec: 120 },
		);

		if (claimed === null || claimed.lockToken === null || claimed.lockToken === undefined) {
			throw new Error("Expected a claimed deployment queue job with a lock token");
		}

		const completed = await deployment.completeQueueJob(claimed.id, {
			workerId: context.workerId,
			lockToken: claimed.lockToken,
			result: { outcome: "e2e-upload-deploy-finished" },
		});

		expect(completed.updated).toBe(true);
		expect(completed.job.status).toBe("succeeded");
	});
});
