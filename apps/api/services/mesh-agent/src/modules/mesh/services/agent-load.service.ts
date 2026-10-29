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

/** Load tracking over a clock and a loop-lag reader, so a test drives time itself. */
export function agentLoadOver(inputs: { readonly now: () => number; readonly eventLoopLagMs: () => number }): AgentLoadShape {
  const pairs = new Map<string, number[]>();
  const bytes: { at: number; size: number }[] = [];
  let openStreams = 0;

  return {
    sample() {
      const cutoff = inputs.now() - WINDOW_MS;
      while (bytes.length > 0 && (bytes[0]?.at ?? cutoff) <= cutoff) {
        bytes.shift();
      }
      return {
        eventLoopLagMs: inputs.eventLoopLagMs(),
        bytesPerSecond: bytes.reduce((total, entry) => total + entry.size, 0),
        openStreams,
      };
    },
    callStarted(pairKey) {
      const now = inputs.now();
      const calls = (pairs.get(pairKey) ?? []).filter((at) => at > now - WINDOW_MS);
      calls.push(now);
      pairs.set(pairKey, calls);
      return calls.length;
    },
    streamOpened() {
      openStreams += 1;
    },
    streamClosed() {
      openStreams = Math.max(0, openStreams - 1);
    },
    bytesMoved(size) {
      bytes.push({ at: inputs.now(), size });
    },
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

export class AgentLoad extends Context.Service<AgentLoad, AgentLoadShape>()("mesh-agent/AgentLoad") {
  static readonly live: AgentLoadShape = agentLoadOver({ now: () => Date.now(), eventLoopLagMs: liveEventLoopLag() });
}
