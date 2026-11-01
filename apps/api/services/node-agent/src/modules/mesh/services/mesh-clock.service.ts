import { Context } from "effect";

export type MeshClockShape = {
  /** Epoch ms. */
  readonly now: () => number;
};

/** The agent's time source, an input so leases, expiry and hints are testable without waiting. */
export class MeshClock extends Context.Service<MeshClock, MeshClockShape>()("node-agent/MeshClock") {
  static readonly live: MeshClockShape = { now: () => Date.now() };
}
