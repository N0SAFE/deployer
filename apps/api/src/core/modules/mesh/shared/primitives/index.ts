/**
 * Barrel d'export des primitives distribuées partagées.
 *
 * Tous les sous-systèmes (topology, topic, resource-discovery)
 * importent depuis ce barrel plutôt que depuis des chemins profonds.
 *
 * @example
 * import { Clock, SlidingDedupWindow, TokenBucket } from "../../shared/primitives";
 */

export { SystemClock, FakeClock, CLOCK_TOKEN } from "./clock";
export type { Clock } from "./clock";

export { SystemIdGenerator, SequentialIdGenerator, ID_GENERATOR_TOKEN } from "./id-generator";
export type { IdGenerator } from "./id-generator";

export {
    HybridLogicalClock,
    compareHlc,
    serializeHlc,
    deserializeHlc,
} from "./hybrid-logical-clock";
export type { Hlc } from "./hybrid-logical-clock";

export { LwwMap } from "./lww-map";
export type { LwwEntry } from "./lww-map";

export { OrSet } from "./or-set";

export { PhiAccrualDetector } from "./phi-accrual-detector";

export { SlidingDedupWindow } from "./sliding-dedup-window";

export { TokenBucket } from "./token-bucket";

export { BoundedEventLog } from "./bounded-event-log";
export type { LogEntry } from "./bounded-event-log";

export { FencingTokenIssuer, isFencedOperationValid } from "./fencing-token";
export type { FencedOperation } from "./fencing-token";

export { InMemoryPullCursor } from "./pull-cursor";
export type { PullCursor } from "./pull-cursor";