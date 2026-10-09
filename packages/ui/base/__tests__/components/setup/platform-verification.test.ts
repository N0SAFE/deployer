import { describe, expect, it, vi } from "vitest"
import type { SetupPostSetupVerification, SetupVerificationTarget } from "@repo/contracts-entities"

import {
	buildVerificationTasks,
	isVerified,
	judgeTarget,
	probeFromBrowser,
	verificationFailed,
	type VerificationInput,
} from "@repo/ui/components/setup/platform-verification"

/**
 * The final verification gates the Continue button, so the cases that matter are
 * the ones that used to look like success: an ingress that is up but routes
 * nothing yet, a browser that cannot reach a healthy platform, and an "API only"
 * install that has no dashboard to wait for.
 */

function target(overrides: Partial<SetupVerificationTarget> = {}): SetupVerificationTarget {
	return {
		id: "api",
		expected: true,
		host: "api.deployer.localhost",
		probeUrl: "http://api.deployer.localhost/health",
		routed: { ok: true, status: 200, detail: "routed (HTTP 200)" },
		...overrides,
	}
}

function verification(...targets: SetupVerificationTarget[]): SetupPostSetupVerification {
	return { checkedAt: "2026-01-01T00:00:00Z", targets }
}

const web = (overrides: Partial<SetupVerificationTarget> = {}) =>
	target({ id: "web", host: "web.deployer.localhost", probeUrl: "http://web.deployer.localhost", ...overrides })

function input(overrides: Partial<VerificationInput> = {}): VerificationInput {
	return { verification: null, browserByTarget: {}, serverUnavailable: false, active: true, expired: false, ...overrides }
}

describe("probeFromBrowser", () => {
	it("passes when the browser gets any answer, and asks without CORS so the status stays hidden", async () => {
		const fetchImpl = vi.fn(() => Promise.resolve(new Response(null)))
		const result = await probeFromBrowser("http://x", { fetchImpl: fetchImpl as unknown as typeof fetch })
		expect(result.ok).toBe(true)
		expect(fetchImpl).toHaveBeenCalledWith("http://x", expect.objectContaining({ mode: "no-cors", cache: "no-store" }))
	})

	it("fails with the browser's own reason when the network path is broken", async () => {
		const fetchImpl = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")))
		const result = await probeFromBrowser("http://x", { fetchImpl: fetchImpl as unknown as typeof fetch })
		expect(result).toMatchObject({ ok: false })
		expect(result.detail).toContain("Failed to fetch")
	})

	it("gives up after the timeout instead of waiting on a half-open socket", async () => {
		const hangs = ((_url: string, init?: RequestInit) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => {
					reject(new DOMException("aborted", "AbortError"))
				})
			})) as unknown as typeof fetch
		const result = await probeFromBrowser("http://x", { timeoutMs: 10, fetchImpl: hangs })
		expect(result.ok).toBe(false)
		expect(result.detail).toContain("no answer")
	})
})

describe("judgeTarget", () => {
	it("waits, rather than failing, while the platform cannot be asked (the ingress is switching)", () => {
		expect(judgeTarget("The API", { target: null, browser: null, serverUnavailable: true }).state).toBe("checking")
		expect(judgeTarget("The API", { target: null, browser: null, serverUnavailable: false }).state).toBe("pending")
	})

	it("is NOT ok on the server's word alone — the browser has to reach it too", () => {
		const verdict = judgeTarget("The API", { target: target(), browser: null, serverUnavailable: false })
		expect(verdict.state).toBe("checking")
	})

	it("is ok only when the ingress routes it AND this browser reached it", () => {
		const verdict = judgeTarget("The API", { target: target(), browser: { ok: true, detail: "answered" }, serverUnavailable: false })
		expect(verdict.state).toBe("ok")
		expect(verdict.lines).toHaveLength(2)
	})

	it("fails when the ingress has no route, without ever asking the browser", () => {
		const verdict = judgeTarget("The API", {
			target: target({ routed: { ok: false, status: 404, detail: "the ingress is up but has no route for this hostname yet" } }),
			browser: null,
			serverUnavailable: false,
		})
		expect(verdict.state).toBe("failing")
		expect(verdict.lines[0]).toContain("does not route")
	})

	it("fails when the platform is healthy but this browser cannot reach it", () => {
		const verdict = judgeTarget("The dashboard", {
			target: web(),
			browser: { ok: false, detail: "this browser cannot reach it (Failed to fetch)" },
			serverUnavailable: false,
		})
		expect(verdict.state).toBe("failing")
		expect(verdict.lines.at(-1)).toContain("Failed to fetch")
	})

	it("skips a dashboard the installation never asked for", () => {
		const verdict = judgeTarget("The dashboard", {
			target: web({ expected: false, probeUrl: null }),
			browser: null,
			serverUnavailable: false,
		})
		expect(verdict.state).toBe("skipped")
	})
})

describe("buildVerificationTasks", () => {
	it("announces both steps as pending before the pipeline is done", () => {
		const tasks = buildVerificationTasks(input({ active: false }))
		expect(tasks.map((t) => [t.id, t.status])).toEqual([
			["verify_api", "pending"],
			["verify_web", "pending"],
		])
		expect(isVerified(tasks)).toBe(false)
	})

	it("passes only when the API AND the dashboard are verified", () => {
		const tasks = buildVerificationTasks(
			input({
				verification: verification(target(), web()),
				browserByTarget: { api: { ok: true, detail: "" }, web: { ok: true, detail: "" } },
			}),
		)
		expect(isVerified(tasks)).toBe(true)
	})

	it("does not pass while only one of them is verified", () => {
		const tasks = buildVerificationTasks(
			input({ verification: verification(target(), web()), browserByTarget: { api: { ok: true, detail: "" } } }),
		)
		expect(tasks.find((t) => t.id === "verify_api")?.status).toBe("done")
		expect(isVerified(tasks)).toBe(false)
	})

	it("keeps a failing target RUNNING until the deadline, then fails it with the reason", () => {
		const notRouted = verification(
			target({ routed: { ok: false, status: null, detail: "the cluster ingress is not reachable (ECONNREFUSED)" } }),
			web({ expected: false, probeUrl: null }),
		)
		const waiting = buildVerificationTasks(input({ verification: notRouted }))
		expect(waiting.find((t) => t.id === "verify_api")?.status).toBe("running")
		expect(verificationFailed(waiting)).toBe(false)

		const expired = buildVerificationTasks(input({ verification: notRouted, expired: true }))
		expect(expired.find((t) => t.id === "verify_api")).toMatchObject({ status: "error" })
		expect(expired.find((t) => t.id === "verify_api")?.error).toContain("ECONNREFUSED")
		expect(verificationFailed(expired)).toBe(true)
	})

	it("counts an API-only install's missing dashboard as done, not as a gap", () => {
		const tasks = buildVerificationTasks(
			input({
				verification: verification(target(), web({ expected: false, probeUrl: null })),
				browserByTarget: { api: { ok: true, detail: "" } },
			}),
		)
		expect(tasks.find((t) => t.id === "verify_web")?.status).toBe("done")
		expect(isVerified(tasks)).toBe(true)
	})

	it("shows the wait for the platform's own answer as progress, not as a failure", () => {
		const tasks = buildVerificationTasks(input({ verification: null, serverUnavailable: true }))
		expect(tasks.every((t) => t.status === "running")).toBe(true)
		expect(tasks[0]?.logs[0]).toContain("Waiting for the platform API")
	})
})
