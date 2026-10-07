import { AppLogger } from '@repo/logger'

/** Identifies this tool as the source of every log line it writes. */
const APP_SOURCE_TAG = 'dependency-builder'

/**
 * A logger scoped to one class.
 *
 * The repository standardises on `AppLogger` for structured, redacted output,
 * and on a per-class scope so a line names its origin. `AppLogger.log` is the
 * underlying structured logger, which is what the call sites use.
 *
 * A plain function rather than DI: the logger has no configuration and no
 * lifecycle, so injecting it would add a provider per consumer and change
 * nothing about the output.
 */
export function scopedLogger(namespace: string) {
    return new AppLogger(APP_SOURCE_TAG).scope(namespace).log
}
