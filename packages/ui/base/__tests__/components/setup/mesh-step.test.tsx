import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { SetupMeshJoinResult, SetupMeshStatus } from "@deployer/contracts-entities"

import { MeshStep, type MeshStepApi } from "@deployer/ui/components/setup/steps/mesh-step"

/**
 * The mesh card is the ONLY surface a node without a platform has for joining a
 * swarm, so these pin the three states the operator can be in: standalone, in a
 * swarm, and refused — a refusal must show the agent's reason, not a blank card.
 */

function makeApi(options: {
	status?: SetupMeshStatus
	join?: MeshStepApi["joinMesh"]
	issue?: MeshStepApi["issueMeshToken"]
}): MeshStepApi {
	return {
		useMeshStatus: () => ({ data: options.status, refetch: vi.fn() }),
		joinMesh: options.join ?? vi.fn(),
		issueMeshToken: options.issue ?? vi.fn(),
	}
}

const standalone: SetupMeshStatus = {
	available: true,
	agentId: "node-a",
	interfaceUp: true,
	meshAddress: "10.88.0.2",
	nodeId: null,
	swarm: null,
}

const inSwarm: SetupMeshStatus = {
	...standalone,
	nodeId: "platform-1",
	swarm: {
		nodes: 2,
		peers: [{ nodeId: "node-b", meshAddress: "10.88.0.3", handshake: true }],
	},
}

describe("MeshStep", () => {
	afterEach(cleanup)

	it("shows the swarm and its peers", () => {
		render(<MeshStep api={makeApi({ status: inSwarm })} />)

		expect(screen.getByText(/swarm of 2 nodes/i)).toBeInTheDocument()
		expect(screen.getByText("node-b")).toBeInTheDocument()
		expect(screen.getByText("platform-1")).toBeInTheDocument()
	})

	it("says standalone when the agent has no peers", () => {
		render(<MeshStep api={makeApi({ status: standalone })} />)

		expect(screen.getByText(/not in a swarm/i)).toBeInTheDocument()
	})

	it("explains a missing agent without failing", () => {
		render(<MeshStep api={makeApi({ status: { ...standalone, available: false } })} />)

		expect(screen.getByText(/no mesh agent answered/i)).toBeInTheDocument()
	})

	it("shows the agent's reason when an invite is refused", async () => {
		const join = vi.fn(
			async (): Promise<SetupMeshJoinResult> => ({
				joined: false,
				swarmId: null,
				agents: [],
				reason: "This invite is not valid for this swarm.",
			}),
		)
		render(<MeshStep api={makeApi({ status: standalone, join })} />)

		fireEvent.change(screen.getByLabelText(/join a swarm/i), { target: { value: "bad-token" } })
		fireEvent.click(screen.getByRole("button", { name: /^join$/i }))

		expect(await screen.findByText(/not valid for this swarm/i)).toBeInTheDocument()
		expect(join).toHaveBeenCalledWith({ token: "bad-token" })
	})

	it("shows a freshly issued invite once", async () => {
		const issue = vi.fn(async () => ({ token: "invite-xyz" }))
		render(<MeshStep api={makeApi({ status: standalone, issue })} />)

		fireEvent.click(screen.getByRole("button", { name: /create an invite/i }))

		expect(await screen.findByText("invite-xyz")).toBeInTheDocument()
		expect(screen.getByText(/shown once/i)).toBeInTheDocument()
		expect(issue).toHaveBeenCalledWith({})
	})
})
