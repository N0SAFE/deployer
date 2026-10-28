import { randomUUID } from "node:crypto";

import type { DeploymentDeadLetterJob, DeploymentQueueJob } from "@deployer/contracts-entities";
import { Effect } from "effect";

import {
	DEFAULT_RETRY_DELAY_MS,
	REAPED_AVAILABLE_DELAY_MS,
	type DeploymentQueueRepositoryShape,
} from "./deployment-queue.repository";

/**
 * The queue repository over plain maps, for unit specs that exercise the lifecycle and the services built on
 * it without a database. It follows the same rules as the Postgres one (idempotent enqueue, claim only what is
 * queued and due, every write guarded by worker id and lock token); the real thing is proven against Postgres in
 * `deployment-queue.e2e-spec.ts`.
 */
export function makeInMemoryDeploymentQueueRepository(): DeploymentQueueRepositoryShape {
	const jobs = new Map<string, DeploymentQueueJob>();
	const deadLetters = new Map<string, DeploymentDeadLetterJob>();
	const held = (job: DeploymentQueueJob | undefined, workerId: string, lockToken: string): job is DeploymentQueueJob =>
		job !== undefined && job.workerId === workerId && job.lockToken === lockToken && (job.status === "claimed" || job.status === "running");

	const enqueue: DeploymentQueueRepositoryShape["enqueue"] = (input) =>
		Effect.sync(() => {
			const existing = [...jobs.values()].find((job) => job.idempotencyKey === input.idempotencyKey);
			if (existing) return { job: existing, deduplicated: true };
			const now = new Date().toISOString();
			const job: DeploymentQueueJob = {
				id: randomUUID(),
				type: input.type,
				status: "queued",
				idempotencyKey: input.idempotencyKey,
				workerId: null,
				lockToken: null,
				payload: input.payload,
				attempts: 0,
				maxAttempts: input.maxAttempts,
				availableAt: input.availableAt ?? now,
				lastHeartbeatAt: null,
				leaseExpiresAt: null,
				connectivityStatus: null,
				startedAt: null,
				completedAt: null,
				lastError: null,
				metadata: input.metadata ?? null,
				createdAt: now,
				updatedAt: now,
			};
			jobs.set(job.id, job);
			return { job, deduplicated: false };
		});

	const claimOne = (job: DeploymentQueueJob, input: Parameters<DeploymentQueueRepositoryShape["claim"]>[0], now: number) => {
		const iso = new Date(now).toISOString();
		const claimed: DeploymentQueueJob = {
			...job,
			status: "claimed",
			workerId: input.workerId,
			lockToken: randomUUID(),
			connectivityStatus: input.workerConnectivityStatus ?? job.connectivityStatus,
			startedAt: job.startedAt ?? iso,
			leaseExpiresAt: new Date(now + input.leaseDurationSec * 1000).toISOString(),
			updatedAt: iso,
		};
		jobs.set(claimed.id, claimed);
		return claimed;
	};
	const claimable = (job: DeploymentQueueJob, types: readonly string[] | undefined, now: number) =>
		job.status === "queued" && new Date(job.availableAt).getTime() <= now && (types === undefined || types.includes(job.type));

	const claim: DeploymentQueueRepositoryShape["claim"] = (input) =>
		Effect.sync(() => {
			const now = Date.now();
			return [...jobs.values()].filter((job) => claimable(job, input.types, now)).slice(0, input.limit).map((job) => claimOne(job, input, now));
		});

	const claimByIdempotencyKey: DeploymentQueueRepositoryShape["claimByIdempotencyKey"] = (key, input) =>
		Effect.sync(() => {
			const now = Date.now();
			const job = [...jobs.values()].find((candidate) => candidate.idempotencyKey === key && claimable(candidate, input.types, now));
			return job === undefined ? null : claimOne(job, input, now);
		});

	const heartbeat: DeploymentQueueRepositoryShape["heartbeat"] = (jobId, input) =>
		Effect.sync(() => {
			const job = jobs.get(jobId);
			if (!held(job, input.workerId, input.lockToken)) return null;
			const now = new Date();
			const updated: DeploymentQueueJob = {
				...job,
				status: "running",
				lastHeartbeatAt: now.toISOString(),
				leaseExpiresAt: new Date(now.getTime() + input.extendLeaseSec * 1000).toISOString(),
				connectivityStatus: input.connectivityStatus ?? job.connectivityStatus,
				updatedAt: now.toISOString(),
			};
			jobs.set(jobId, updated);
			return updated;
		});

	const complete: DeploymentQueueRepositoryShape["complete"] = (jobId, workerId, lockToken, result) =>
		Effect.sync(() => {
			const job = jobs.get(jobId);
			if (!held(job, workerId, lockToken)) return null;
			const now = new Date().toISOString();
			const updated: DeploymentQueueJob = {
				...job,
				status: "succeeded",
				completedAt: now,
				lockToken: null,
				leaseExpiresAt: null,
				metadata: result ? { ...(job.metadata ?? {}), result } : job.metadata,
				updatedAt: now,
			};
			jobs.set(jobId, updated);
			return updated;
		});

	const fail: DeploymentQueueRepositoryShape["fail"] = (jobId, input) =>
		Effect.sync(() => {
			const job = jobs.get(jobId);
			if (!held(job, input.workerId, input.lockToken)) return null;
			const now = new Date();
			const attempts = job.attempts + 1;
			if (input.retryable && attempts < job.maxAttempts) {
				const retry: DeploymentQueueJob = {
					...job,
					status: "queued",
					attempts,
					availableAt: input.retryAt ?? new Date(now.getTime() + DEFAULT_RETRY_DELAY_MS).toISOString(),
					lastError: input.error,
					workerId: null,
					lockToken: null,
					leaseExpiresAt: null,
					lastHeartbeatAt: null,
					updatedAt: now.toISOString(),
				};
				jobs.set(jobId, retry);
				return { job: retry, movedToDeadLetter: false, deadLetterJob: null };
			}
			const failed: DeploymentQueueJob = {
				...job,
				status: "failed",
				attempts,
				lastError: input.error,
				completedAt: now.toISOString(),
				lockToken: null,
				leaseExpiresAt: null,
				updatedAt: now.toISOString(),
			};
			jobs.set(jobId, failed);
			const dead: DeploymentDeadLetterJob = {
				id: randomUUID(),
				originalJobId: failed.id,
				idempotencyKey: failed.idempotencyKey,
				type: failed.type,
				payload: failed.payload,
				reason: input.retryable ? "max_attempts_exceeded" : "non_retryable_error",
				attempts: failed.attempts,
				maxAttempts: failed.maxAttempts,
				lastError: input.error,
				movedAt: now.toISOString(),
				movedBy: input.workerId,
				replayCount: 0,
				lastReplayAt: null,
				metadata: failed.metadata,
			};
			deadLetters.set(dead.id, dead);
			return { job: failed, movedToDeadLetter: true, deadLetterJob: dead };
		});

	const cancel: DeploymentQueueRepositoryShape["cancel"] = (jobId, reason) =>
		Effect.sync(() => {
			const job = jobs.get(jobId);
			if (job === undefined || !["queued", "claimed", "running"].includes(job.status)) return null;
			const now = new Date().toISOString();
			const cancelled: DeploymentQueueJob = { ...job, status: "cancelled", lastError: reason, completedAt: now, lockToken: null, leaseExpiresAt: null, updatedAt: now };
			jobs.set(jobId, cancelled);
			return cancelled;
		});

	const reapExpiredLeases: DeploymentQueueRepositoryShape["reapExpiredLeases"] = (now = new Date()) =>
		Effect.sync(() => {
			const released: DeploymentQueueJob[] = [];
			for (const job of jobs.values()) {
				if ((job.status !== "claimed" && job.status !== "running") || job.leaseExpiresAt === null) continue;
				if (new Date(job.leaseExpiresAt).getTime() > now.getTime()) continue;
				const requeued: DeploymentQueueJob = {
					...job,
					status: "queued",
					workerId: null,
					lockToken: null,
					leaseExpiresAt: null,
					lastHeartbeatAt: null,
					availableAt: new Date(now.getTime() + REAPED_AVAILABLE_DELAY_MS).toISOString(),
					updatedAt: now.toISOString(),
				};
				jobs.set(job.id, requeued);
				released.push(requeued);
			}
			return released;
		});

	const findById: DeploymentQueueRepositoryShape["findById"] = (jobId) => Effect.sync(() => jobs.get(jobId) ?? null);

	const list: DeploymentQueueRepositoryShape["list"] = (filters) =>
		Effect.sync(() => {
			const matching = [...jobs.values()]
				.filter(
					(job) =>
						(filters.type === undefined || job.type === filters.type) &&
						(filters.status === undefined || job.status === filters.status) &&
						(filters.workerId === undefined || job.workerId === filters.workerId) &&
						(filters.deploymentId === undefined || job.payload.deploymentId === filters.deploymentId) &&
						(filters.serviceId === undefined || job.payload.serviceId === filters.serviceId) &&
						(filters.projectId === undefined || job.payload.projectId === filters.projectId),
				)
				.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
			return { items: matching.slice(filters.offset, filters.offset + filters.limit), total: matching.length };
		});

	const hasLiveJobForDeployment: DeploymentQueueRepositoryShape["hasLiveJobForDeployment"] = (deploymentId) =>
		Effect.sync(() => [...jobs.values()].some((job) => job.payload.deploymentId === deploymentId && ["queued", "claimed", "running"].includes(job.status)));

	const listDeadLetters: DeploymentQueueRepositoryShape["listDeadLetters"] = (input) =>
		Effect.sync(() => {
			const matching = [...deadLetters.values()].filter(
				(item) =>
					(input.type === undefined || item.type === input.type) &&
					(input.reason === undefined || item.reason === input.reason) &&
					(input.from === undefined || item.movedAt >= input.from) &&
					(input.to === undefined || item.movedAt <= input.to),
			);
			return { items: matching.slice(input.offset, input.offset + input.limit), total: matching.length };
		});

	const findDeadLetter: DeploymentQueueRepositoryShape["findDeadLetter"] = (id) => Effect.sync(() => deadLetters.get(id) ?? null);

	const replayDeadLetter: DeploymentQueueRepositoryShape["replayDeadLetter"] = (id, replay) =>
		Effect.gen(function* () {
			const dead = deadLetters.get(id);
			if (dead === undefined) return null;
			const { job } = yield* enqueue({
				type: dead.type,
				idempotencyKey: `${dead.idempotencyKey}:replay:${String(dead.replayCount + 1)}`,
				payload: replay.payload,
				maxAttempts: dead.maxAttempts,
				...(replay.availableAt === undefined ? {} : { availableAt: replay.availableAt }),
				metadata: replay.metadata,
			});
			const updated: DeploymentDeadLetterJob = { ...dead, replayCount: dead.replayCount + 1, lastReplayAt: new Date().toISOString() };
			deadLetters.set(id, updated);
			return { job, deadLetter: updated };
		});

	return { enqueue, claim, claimByIdempotencyKey, heartbeat, complete, fail, cancel, reapExpiredLeases, findById, list, hasLiveJobForDeployment, listDeadLetters, findDeadLetter, replayDeadLetter };
}
