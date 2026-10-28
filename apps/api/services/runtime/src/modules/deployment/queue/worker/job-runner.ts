import { Cause, Data, Duration, Effect, Exit, Fiber, Schedule } from "effect";

/** The lease was lost (another worker owns the job, or it was cancelled): the work stops and writes nothing. */
export class LeaseLost extends Data.TaggedError("LeaseLost")<{ readonly jobId: string }> {}

/** What a job runner needs from the queue. Every write is guarded by the lock token, so a stale holder gets `false`. */
export type JobRunnerPorts<Job, Claimed extends { readonly id: string }, Result, Failure> = {
	/** Claims `job` for this worker; null when it is gone, taken or not yet due. */
	readonly claim: (job: Job) => Effect.Effect<Claimed | null, unknown>;
	/** Renews the lease; false when the worker no longer holds the job. */
	readonly heartbeat: (claimed: Claimed) => Effect.Effect<boolean, unknown>;
	/** Writes the success; false when the lease was lost in the meantime. */
	readonly complete: (claimed: Claimed, result: Result) => Effect.Effect<boolean, unknown>;
	/** Writes the failure (retry or dead-letter, the queue decides); false when the lease was lost. */
	readonly fail: (claimed: Claimed, failure: Failure) => Effect.Effect<boolean, unknown>;
};

export type JobOutcome =
	| "skipped"
	| "completed"
	| "failed"
	/** Cancelled on request: the canceller wrote the terminal state, so the runner writes nothing. */
	| "cancelled"
	/** The lease was lost, or the process is shutting down: nothing is written and the lease expiry returns the job. */
	| "abandoned";

export type JobRunnerOptions = {
	/** Heartbeat cadence; the lease must be longer than this. */
	readonly heartbeatEvery: Duration.Input;
	readonly warn: (message: string) => void;
};

/**
 * Runs queue jobs as fibers: one fiber per job, a heartbeat beside it, and a single terminal write.
 *
 *  - The job's own work runs RACED against the heartbeat: a heartbeat that finds the lease gone ends the
 *    race, which interrupts the work, so a worker that lost its job stops working on it.
 *  - `cancel(jobId)` interrupts that fiber. The scope around the work releases everything it acquired,
 *    which is how a scoped child process (`CommandRunner`) or an abortable request is killed.
 *  - Success and failure are written once, with the lock token. A cancel clears the token first, so a
 *    completion racing a cancel loses the write instead of overwriting `cancelled`.
 */
export function makeJobRunner<Job extends { readonly id: string }, Claimed extends { readonly id: string }, Result, Failure>(
	ports: JobRunnerPorts<Job, Claimed, Result, Failure>,
	options: JobRunnerOptions,
) {
	const running = new Map<string, Fiber.Fiber<unknown, unknown>>();
	const cancelRequested = new Set<string>();

	const heartbeatLoop = (claimed: Claimed): Effect.Effect<never, LeaseLost> =>
		Effect.gen(function* () {
			const held = yield* ports.heartbeat(claimed).pipe(
				Effect.catch((error: unknown) =>
					Effect.sync(() => {
						options.warn(`Heartbeat failed for job '${claimed.id}': ${error instanceof Error ? error.message : String(error)}`);
						return true;
					}),
				),
			);
			if (!held) return yield* new LeaseLost({ jobId: claimed.id });
		}).pipe(Effect.repeat(Schedule.spaced(options.heartbeatEvery)), Effect.andThen(Effect.never));

	const write = (label: string, claimed: Claimed, attempt: Effect.Effect<boolean, unknown>) =>
		attempt.pipe(
			Effect.catch((error: unknown) =>
				Effect.sync(() => {
					options.warn(`Writing ${label} for job '${claimed.id}' failed: ${error instanceof Error ? error.message : String(error)}`);
					return false;
				}),
			),
		);

	const run = <E extends Failure>(job: Job, execute: (claimed: Claimed) => Effect.Effect<Result, E>): Effect.Effect<JobOutcome> =>
		Effect.gen(function* () {
			const claimed = yield* ports.claim(job).pipe(
				Effect.catch((error: unknown) =>
					Effect.sync(() => {
						options.warn(`Claiming job '${job.id}' failed: ${error instanceof Error ? error.message : String(error)}`);
						return null;
					}),
				),
			);
			if (claimed === null) return "skipped" as const;

			const fiber = yield* Effect.forkChild(Effect.raceFirst(execute(claimed), heartbeatLoop(claimed)));
			running.set(claimed.id, fiber);
			const exit = yield* Effect.exit(Fiber.join(fiber)).pipe(
				// Also on shutdown: interrupting this run must not leave the job listed as running.
				Effect.ensuring(
					Effect.sync(() => {
						running.delete(claimed.id);
					}),
				),
			);
			const cancelled = cancelRequested.delete(claimed.id);

			if (Exit.isSuccess(exit)) {
				const recorded = yield* Effect.exit(ports.complete(claimed, exit.value));
				if (Exit.isSuccess(recorded)) {
					if (!recorded.value) options.warn(`Job '${claimed.id}' finished but its lease was gone; the result was not recorded`);
					return recorded.value ? ("completed" as const) : ("abandoned" as const);
				}
				// Recording the result failed: the deployment did not finish cleanly, so the job fails with that error.
				const completionFailure = Cause.findErrorOption(recorded.cause);
				yield* write("failure", claimed, ports.fail(claimed, (completionFailure._tag === "Some" ? completionFailure.value : Cause.squash(recorded.cause)) as Failure));
				return "failed" as const;
			}

			if (cancelled) return "cancelled" as const;

			const failure = Cause.findErrorOption(exit.cause);
			if (failure._tag === "Some") {
				if (failure.value instanceof LeaseLost) return "abandoned" as const;
				yield* write("failure", claimed, ports.fail(claimed, failure.value));
				return "failed" as const;
			}
			if (Cause.hasInterruptsOnly(exit.cause)) return "abandoned" as const;

			// A defect (a bug, not a failed deployment): record it as a failure so the job does not hang.
			yield* write("failure", claimed, ports.fail(claimed, Cause.squash(exit.cause) as Failure));
			return "failed" as const;
		});

	/** Interrupts the job's fiber. Resolves to whether a job by that id was running here. */
	const cancel = (jobId: string): Effect.Effect<boolean> =>
		Effect.gen(function* () {
			const fiber = running.get(jobId);
			if (fiber === undefined) return false;
			cancelRequested.add(jobId);
			yield* Fiber.interrupt(fiber);
			return true;
		});

	return {
		run,
		cancel,
		/** Ids of the jobs executing right now. */
		runningJobIds: (): string[] => [...running.keys()],
	};
}
