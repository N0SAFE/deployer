import { Context } from "effect";

export type MeshClockShape = {
	/** Epoch ms. */
	readonly now: () => number;
};

/** The agent's time source, an input so leases and expiry stay testable without waiting. */
export class MeshClock extends Context.Service<MeshClock, MeshClockShape>()("demo/MeshClock") {
	static readonly live: MeshClockShape = { now: () => Date.now() };
}
