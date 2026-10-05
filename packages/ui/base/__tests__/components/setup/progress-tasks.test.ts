import { describe, expect, it } from "vitest"

import {
	buildTasksFromEvents,
	isPipelineComplete,
	type ProgressTask,
} from "@repo/ui/components/setup/progress-tasks"
import type { SetupStreamEvent } from "@repo/contracts-entities"

/**
 * `buildTasksFromEvents` merges TWO producers into one timeline: the setup app
 * announces its own steps (including `promote_ingress`) at boot, and the API
 * announces its provisioning steps later, once it is scheduled and running.
 *
 * These tests pin the two properties that merge got wrong or could regress on:
 * the RENDER ORDER, and the COMPLETION GATE.
 */

/** A `step_detail` event, which is how a producer announces a step it will run. */
function stepDetail(stepId: string, title = stepId): SetupStreamEvent {
	return {
		type: "step_detail",
		stepId,
		title,
		description: title,
		seq: 1,
		ts: "2026-01-01T00:00:00Z",
	} as SetupStreamEvent
}

/** A `snapshot` event carrying the authoritative state of the steps it names. */
function snapshot(steps: Array<{ id: string; status: string }>): SetupStreamEvent {
	return {
		type: "snapshot",
		seq: 2,
		ts: "2026-01-01T00:00:00Z",
		steps: steps.map((step) => ({
			id: step.id,
			title: step.id,
			description: step.id,
			status: step.status,
			logs: [],
		})),
	} as unknown as SetupStreamEvent
}

describe("buildTasksFromEvents — render order", () => {
	/**
	 * THE ORDER THE OPERATOR READS MUST BE THE EXECUTION ORDER.
	 *
	 * Setup appends its steps to the list first, so pure insertion order put the
	 * ingress swap in the MIDDLE of the pipeline — above the API's provisioning
	 * steps, which had not been announced yet. The operator then saw the ingress
	 * marked done with provisioning still pending below it.
	 */
	it("renders the ingress swap LAST even though setup announces it first", () => {
		const events: SetupStreamEvent[] = [
			stepDetail("initialize_swarm"),
			stepDetail("start_api"),
			stepDetail("await_api_boot"),
			stepDetail("promote_ingress"),
			// The API's steps arrive afterwards — and must render ABOVE it.
			stepDetail("provision_database"),
			stepDetail("run_migrations"),
			stepDetail("finalize"),
		]

		const ids = buildTasksFromEvents(events).map((task) => task.id)

		expect(ids).toEqual([
			"initialize_swarm",
			"start_api",
			"await_api_boot",
			"provision_database",
			"run_migrations",
			"finalize",
			"promote_ingress",
		])
	})

	it("keeps an unknown step visible, sorted after the known ones", () => {
		const events: SetupStreamEvent[] = [stepDetail("promote_ingress"), stepDetail("a_future_step")]

		const ids = buildTasksFromEvents(events).map((task) => task.id)

		// Not dropped, and not allowed to displace a step whose position is known.
		expect(ids).toEqual(["promote_ingress", "a_future_step"])
	})

	it("carries a snapshot's status into the sorted order", () => {
		const events: SetupStreamEvent[] = [
			stepDetail("promote_ingress"),
			stepDetail("finalize"),
			snapshot([
				{ id: "promote_ingress", status: "in_progress" },
				{ id: "finalize", status: "completed" },
			]),
		]

		const tasks = buildTasksFromEvents(events)

		// `finalize` renders first (it executes first) even though the snapshot
		// named `promote_ingress` first.
		expect(tasks.map((task) => [task.id, task.status])).toEqual([
			["finalize", "done"],
			["promote_ingress", "running"],
		])
	})
})

describe("isPipelineComplete — the Continue gate", () => {
	function tasks(statuses: Array<[string, ProgressTask["status"]]>): ProgressTask[] {
		return statuses.map(([id, status]) => ({
			id,
			label: id,
			description: id,
			status,
			logs: [],
		}))
	}

	/**
	 * The terminal `completed` event reports PROVISIONING success, which lands
	 * BEFORE the ingress swap. Gating on that alone let the operator press
	 * Continue through an ingress that was mid-handover — the "Failed to fetch"
	 * they actually saw.
	 */
	it("is NOT complete while the ingress swap is still running", () => {
		const gate = tasks([
			["provision_database", "done"],
			["finalize", "done"],
			["promote_ingress", "running"],
		])

		expect(isPipelineComplete(gate)).toBe(false)
	})

	it("is NOT complete while any announced step is still pending", () => {
		const gate = tasks([
			["finalize", "done"],
			["promote_ingress", "pending"],
		])

		expect(isPipelineComplete(gate)).toBe(false)
	})

	it("is complete only when every announced step is done", () => {
		const gate = tasks([
			["finalize", "done"],
			["promote_ingress", "done"],
		])

		expect(isPipelineComplete(gate)).toBe(true)
	})

	it("treats an empty pipeline as NOT complete", () => {
		// No steps announced yet means nothing has been proven, not everything.
		expect(isPipelineComplete([])).toBe(false)
	})

	it("is NOT complete when a step failed", () => {
		const gate = tasks([
			["finalize", "done"],
			["promote_ingress", "error"],
		])

		expect(isPipelineComplete(gate)).toBe(false)
	})
})
