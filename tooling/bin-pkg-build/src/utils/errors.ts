import { c } from './colors'

/**
 * Fatal error path for the CLI.
 *
 * Build tools report failures inline (compiler output already streamed) and
 * exit non-zero; throwing here would only add a stack trace nobody reads.
 */
export function die(message: string): never {
    console.error(`${c.red('x')} ${message}`)
    process.exit(1)
}
