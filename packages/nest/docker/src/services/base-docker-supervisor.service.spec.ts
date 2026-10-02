import { describe, expect, it } from "vitest";
import { isSwarmVersionConflict } from "./base-docker-supervisor.service";

/**
 * REGRESSION GUARD for a silent, permanent convergence failure.
 *
 * A swarm update carries the version index it was based on, and the engine
 * rejects a stale one:
 *
 *   rpc error: code = Unknown desc = update out of sequence
 *
 * Two reconciles can inspect the SAME index (a startup pass racing an interval
 * tick, or two supervisors sharing a service). Treating that as fatal meant the
 * service kept its OLD spec forever — a new env or command was discarded while
 * the supervisor still reported success, which is exactly how the managed web
 * console kept booting with a two-variable env it cannot start with.
 */
describe("isSwarmVersionConflict", () => {
    it("detects the engine's out-of-sequence version rejection", () => {
        expect(
            isSwarmVersionConflict(
                new Error("(HTTP code 500) server error - rpc error: code = Unknown desc = update out of sequence"),
            ),
        ).toBe(true);
        expect(isSwarmVersionConflict(new Error("update out of sequence"))).toBe(true);
    });

    it("does NOT treat genuine failures as a lost race", () => {
        // A real rejection must propagate: retrying it would hide the cause and
        // turn one clear error into five.
        expect(isSwarmVersionConflict(new Error("no suitable node (host-mode port already in use on 1 node)"))).toBe(
            false,
        );
        expect(isSwarmVersionConflict(new Error("network deployer-x not found"))).toBe(false);
        expect(isSwarmVersionConflict(new Error("service is not a swarm manager"))).toBe(false);
    });

    it("handles non-Error throwables without crashing", () => {
        expect(isSwarmVersionConflict("update out of sequence")).toBe(true);
        expect(isSwarmVersionConflict(undefined)).toBe(false);
        expect(isSwarmVersionConflict(null)).toBe(false);
    });
});
