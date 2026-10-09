import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { SetupPostSetupVerification, SetupStreamEvent } from "@repo/contracts-entities"

import { ProgressStep } from "@repo/ui/components/setup/steps/progress-step"
import type { SetupWizardApi } from "@repo/ui/components/setup/types"

/**
 * What the operator actually saw: the stream said "done" while the ingress was
 * being replaced, and the Continue button appeared in front of a platform that did
 * not answer. These pin the gate end to end — through the real component, the real
 * verification hook, and a stubbed network.
 */

const ts = "2026-01-01T00:00:00Z"

function snapshot(steps: { id: string; status: string }[]): SetupStreamEvent {
	return {
		type: "snapshot",
		seq: 1,
		ts,
		steps: steps.map((step) => ({ id: step.id, title: step.id, description: step.id, status: step.status, logs: [] })),
	} as unknown as SetupStreamEvent
}

const completed = {
	type: "completed",
	result: { nodeId: "n", strategy: "local", databaseUrl: "x", completedAt: ts },
} as unknown as SetupStreamEvent

/** A pipeline whose every step is done and which has completed. */
const finishedPipeline: SetupStreamEvent[] = [
	snapshot([
		{ id: "start_api", status: "completed" },
		{ id: "promote_ingress", status: "completed" },
	]),
	completed,
]

const routed = { ok: true, status: 200, detail: "routed (HTTP 200)" }
const apiTarget = {
	id: "api" as const,
	expected: true,
	host: "api.deployer.localhost",
	probeUrl: "http://api.deployer.localhost/health",
	routed,
}
const webTarget = {
	id: "web" as const,
	expected: true,
	host: "web.deployer.localhost",
	probeUrl: "http://web.deployer.localhost",
	routed,
}

function makeApi(options: {
	verification?: SetupPostSetupVerification
	verificationError?: boolean
	retryHandover?: SetupWizardApi["retryHandover"]
}): SetupWizardApi {
	return {
		usePostSetupVerification: () => ({
			data: options.verification,
			error: options.verificationError === true ? new Error("SERVICE_UNAVAILABLE") : null,
		}),
		usePostSetupDestination: () => ({ data: { kind: "dashboard", url: "http://web.deployer.localhost", managedWebEnabled: true } }),
		postSetupRedirectUrl: () => "/",
		signInWithEmail: vi.fn(),
		getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : "error"),
		...(options.retryHandover === undefined ? {} : { retryHandover: options.retryHandover }),
	} as unknown as SetupWizardApi
}

const context = { mode: "local" as const }
const continueButton = () => screen.queryByRole("button", { name: /continue to dashboard|finish setup/i })

describe("ProgressStep — the final verification gates the Continue button", () => {
	beforeEach(() => {
		// The browser's own probe: every URL answers unless a test says otherwise.
		vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null))))
	})
	afterEach(() => {
		cleanup()
		vi.unstubAllGlobals()
	})

	it("shows NO button when the pipeline is done but the platform cannot be asked (the ingress is switching)", () => {
		render(<ProgressStep api={makeApi({ verificationError: true })} events={finishedPipeline} context={context} />)

		expect(continueButton()).toBeNull()
		expect(screen.getAllByText(/waiting for the platform api to answer/i)).toHaveLength(2)
	})

	it("shows NO button while the cluster ingress has not published the route yet", () => {
		const notRouted = { ok: false, status: 404, detail: "the ingress is up but has no route for this hostname yet" }
		render(
			<ProgressStep
				api={makeApi({ verification: { checkedAt: ts, targets: [{ ...apiTarget, routed: notRouted }, webTarget] } })}
				events={finishedPipeline}
				context={context}
			/>,
		)

		expect(continueButton()).toBeNull()
		expect(screen.getAllByText(/has no route for this hostname yet/i).length).toBeGreaterThan(0)
	})

	it("shows NO button when the platform is routed but this browser cannot reach it", async () => {
		vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))))
		render(
			<ProgressStep
				api={makeApi({ verification: { checkedAt: ts, targets: [apiTarget, webTarget] } })}
				events={finishedPipeline}
				context={context}
			/>,
		)

		await waitFor(() => {
			expect(screen.getAllByText(/this browser could not reach/i).length).toBeGreaterThan(0)
		})
		expect(continueButton()).toBeNull()
	})

	it("shows the button only once the API and the dashboard are routed AND reachable from the browser", async () => {
		render(
			<ProgressStep
				api={makeApi({ verification: { checkedAt: ts, targets: [apiTarget, webTarget] } })}
				events={finishedPipeline}
				context={context}
			/>,
		)

		expect(await screen.findByRole("button", { name: /continue to dashboard/i })).toBeInTheDocument()
		expect(screen.getByText(/everything answers/i)).toBeInTheDocument()
	})

	it("does not wait for a dashboard an API-only install never asked for", async () => {
		render(
			<ProgressStep
				api={makeApi({
					verification: { checkedAt: ts, targets: [apiTarget, { ...webTarget, expected: false, probeUrl: null }] },
				})}
				events={finishedPipeline}
				context={context}
			/>,
		)

		await waitFor(() => {
			expect(continueButton()).not.toBeNull()
		})
		// Only the API was dialed from the browser.
		expect(vi.mocked(fetch).mock.calls.map(([url]) => (url as string))).toEqual(
			expect.arrayContaining(["http://api.deployer.localhost/health"]),
		)
		expect(vi.mocked(fetch).mock.calls.some(([url]) => (url as string).includes("web.deployer"))).toBe(false)
	})

	it("does not start verifying while the pipeline is still switching the ingress", () => {
		const swapping: SetupStreamEvent[] = [
			snapshot([
				{ id: "start_api", status: "completed" },
				{ id: "promote_ingress", status: "in_progress" },
			]),
			completed,
		]
		render(
			<ProgressStep
				api={makeApi({ verification: { checkedAt: ts, targets: [apiTarget, webTarget] } })}
				events={swapping}
				context={context}
			/>,
		)

		// Both verification steps are listed (so the operator sees what is coming)
		// but nothing is probed and nothing is clickable.
		expect(screen.getByText(/check that the api is reachable/i)).toBeInTheDocument()
		expect(continueButton()).toBeNull()
		expect(fetch).not.toHaveBeenCalled()
	})
})

describe("ProgressStep — the stream's own state", () => {
	afterEach(() => {
		cleanup()
	})

	it("says so when the connection dropped, instead of freezing silently", () => {
		const midSwap: SetupStreamEvent[] = [snapshot([{ id: "promote_ingress", status: "in_progress" }])]
		render(<ProgressStep api={makeApi({})} events={midSwap} context={context} reconnecting />)

		expect(screen.getByRole("status")).toHaveTextContent(/connection to setup interrupted/i)
	})

	it("does not claim to be reconnecting once the run has failed", () => {
		const failed: SetupStreamEvent[] = [{ type: "error", message: "boom" }]
		render(<ProgressStep api={makeApi({})} events={failed} context={context} reconnecting />)

		expect(screen.queryByRole("status")).toBeNull()
	})

	it("offers to retry the failed step, with the reason, when the host can", () => {
		const failed: SetupStreamEvent[] = [
			snapshot([{ id: "promote_ingress", status: "failed" }]),
			{ type: "error", message: "the swarm ingress did not claim the entry port" },
		]
		render(
			<ProgressStep
				api={makeApi({ retryHandover: () => Promise.resolve({ accepted: true }) })}
				events={failed}
				context={context}
			/>,
		)

		expect(screen.getByText(/did not claim the entry port/i)).toBeInTheDocument()
		expect(screen.getByRole("button", { name: /retry the failed step/i })).toBeInTheDocument()
		expect(continueButton()).toBeNull()
	})

	it("offers no retry when the host cannot run the handover", () => {
		const failed: SetupStreamEvent[] = [{ type: "error", message: "boom" }]
		render(<ProgressStep api={makeApi({})} events={failed} context={context} />)

		expect(screen.queryByRole("button", { name: /retry the failed step/i })).toBeNull()
	})
})
