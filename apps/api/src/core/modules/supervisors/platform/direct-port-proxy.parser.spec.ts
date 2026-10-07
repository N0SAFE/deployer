import { describe, expect, it } from "vitest";

import { DirectPortProxySupervisorService } from "./direct-port-proxy.supervisor.service";

/**
 * The bind-error parser, tested against the EXACT engine phrasings.
 *
 * This is the function that decides whether the take-over loop self-heals
 * (drops an unbindable port and converges with the rest) or re-throws and
 * retries forever. A phrasing it does not recognise therefore is not a cosmetic
 * gap — it is an infinite retry, which is what the logs showed.
 */
describe("parseBindErrorHostPort", () => {
	/** The parser is private; reached the same way the existing suite does. */
	function parse(error: unknown, candidates: number[]): number | null {
		const svc = Object.create(DirectPortProxySupervisorService.prototype) as {
			parseBindErrorHostPort(error: unknown, candidates: number[]): number | null;
		};
		return svc.parseBindErrorHostPort(error, candidates);
	}

	it("parses swarm's quoted ingress-port wording (the real regression)", () => {
		// Observed verbatim in production logs:
		//   port '3005' is already in use by service 'deployer-api' (387sgc…) as an ingress port
		const message =
			"(HTTP code 400) unexpected - rpc error: code = InvalidArgument desc = " +
			"port '3005' is already in use by service 'deployer-api' (387sgc8chj46gv12ftt6v16is) as an ingress port";
		expect(parse(new Error(message), [3005, 3000])).toBe(3005);
	});

	it("parses the docker Bind-for wording", () => {
		const message = "Bind for 0.0.0.0:80 failed: port is already allocated";
		expect(parse(new Error(message), [80])).toBe(80);
	});

	it("uses the single candidate when the message names no port at all", () => {
		// `"port is already allocated"` arrives with no port, and it is a REAL
		// conflict. With one candidate there is nothing to disambiguate, so it
		// must resolve — returning null here re-throws and loops forever.
		expect(parse(new Error("port is already allocated"), [3005])).toBe(3005);
	});

	it("refuses to guess when several candidates exist and none is named", () => {
		// Guessing would drop the WRONG port, so the error must propagate to a
		// human instead of being silently "healed".
		expect(parse(new Error("port is already allocated"), [3005, 3000])).toBeNull();
	});

	it("returns null for an unrelated error, so it is NOT swallowed", () => {
		// A genuine failure must propagate rather than be mistaken for a conflict.
		expect(parse(new Error("no such image: nginx:alpine"), [80])).toBeNull();
	});

	it("does not match a port that only appears as part of a longer number", () => {
		// Guards the `(?![0-9])` boundary: 30055 must not read as 3005.
		expect(parse(new Error("address already in use on 30055"), [3005])).toBeNull();
	});

	it("ignores a port outside the valid range", () => {
		expect(parse(new Error("port '99999' is already in use by service 'x'"), [80])).toBeNull();
	});
});
