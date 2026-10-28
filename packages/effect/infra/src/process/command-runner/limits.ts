import { Duration } from "effect";

export const DEFAULT_TIMEOUT = Duration.minutes(10);
export const DEFAULT_MAX_OUTPUT = 8 * 1024 * 1024;
export const DEFAULT_KILL_GRACE = Duration.seconds(5);
export const STDERR_TAIL_CHARS = 4096;
export const MIN_SECRET_LENGTH = 4;
