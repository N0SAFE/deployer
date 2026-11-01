import { monitorEventLoopDelay } from "node:perf_hooks";

import { Context } from "effect";

import type { LeaseInput } from "../rules/lease-policy";

export type AgentLoadSample = LeaseInput["agent"];

export type AgentLoadShape = {
  /** What the agent can say about its own pressure right now; the lease policy decides what to do about it. */
  readonly sample: () => AgentLoadSample;
  /** Counts a call to `pairKey` and returns how many calls per second that pair is making. */
  readonly callStarted: (pairKey: string) => number;
  readonly streamOpened: () => void;
  readonly streamClosed: () => void;
  /** Bytes the transport moved; fed by the transport, which sees them without parsing a payload. */
  readonly bytesMoved: (bytes: number) => void;
};

const WINDOW_MS = 1_000;
/**
 * How many samples each one-second window keeps. A LAN node never reaches this; a peer that floods calls or bytes would
 * otherwise grow the window until the process runs out of memory. The oldest entries are dropped, so the rate
 * under-reports under attack instead of the agent dying.
 */
const MAX_WINDOW_ENTRIES = 10_000;

/**
 * Load tracking over a clock and a loop-lag reader, so a test drives time itself.
 *
 * The two inputs are constructor arguments with defaults, so the module provides `AgentLoad.live` with the real clock
 * and a spec hands in its own: `new AgentLoad.live({ now: () => 1_000, eventLoopLagMs: () => 0 })`.
 */
export class AgentLoad extends Context.Service<AgentLoad, AgentLoadShape>()("node-agent/AgentLoad") {
  static readonly live = class AgentLoadImpl implements AgentLoadShape {
    private readonly inputs: { readonly now: () => number; readonly eventLoopLagMs: () => number };
    private readonly pairs = new Map<string, number[]>();
    private readonly bytes: { at: number; size: number }[] = [];
    private openStreams = 0;

    constructor(inputs: { readonly now: () => number; readonly eventLoopLagMs: () => number } = {
      now: () => Date.now(),
      eventLoopLagMs: liveEventLoopLag(),
    }) {
      this.inputs = inputs;
    }

    sample() {
      const cutoff = this.inputs.now() - WINDOW_MS;
      const bytes = this.bytes;
      while (bytes.length > 0 && (bytes[0]?.at ?? cutoff) <= cutoff) {
        bytes.shift();
      }
      return {
        eventLoopLagMs: this.inputs.eventLoopLagMs(),
        bytesPerSecond: bytes.reduce((total, entry) => total + entry.size, 0),
        openStreams: this.openStreams,
      };
    }

    callStarted(pairKey: string) {
      const now = this.inputs.now();
      const pairs = this.pairs;
      const calls = (pairs.get(pairKey) ?? []).filter((at) => at > now - WINDOW_MS);
      calls.push(now);
      if (calls.length > MAX_WINDOW_ENTRIES) {
        calls.splice(0, calls.length - MAX_WINDOW_ENTRIES);
      }
      pairs.set(pairKey, calls);
      return calls.length;
    }

    streamOpened() {
      this.openStreams += 1;
    }

    streamClosed() {
      this.openStreams = Math.max(0, this.openStreams - 1);
    }

    bytesMoved(size: number) {
      const bytes = this.bytes;
      bytes.push({ at: this.inputs.now(), size });
      if (bytes.length > MAX_WINDOW_ENTRIES) {
        bytes.splice(0, bytes.length - MAX_WINDOW_ENTRIES);
      }
    }
  };
}

function liveEventLoopLag(): () => number {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  return () => {
    const lag = histogram.mean / 1e6;
    histogram.reset();
    return Number.isFinite(lag) ? lag : 0;
  };
}
