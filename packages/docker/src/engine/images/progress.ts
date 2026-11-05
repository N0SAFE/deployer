import type Docker from 'dockerode'

function progressLine(event: Record<string, unknown>): string | null {
    if (typeof event.stream === 'string' && event.stream.trim().length > 0)
        return event.stream.trim()
    if (typeof event.status === 'string') {
        const status = event.status.trim()
        const layerId = typeof event.id === 'string' ? event.id.trim() : ''
        const progress =
            typeof event.progress === 'string' ? event.progress.trim() : ''
        const text = `${status}${progress.length > 0 ? ` ${progress}` : ''}`
        return layerId.length > 0 ? `${layerId}: ${text}` : text
    }
    if (event.error)
        return `error: ${typeof event.error === 'string' ? event.error : JSON.stringify(event.error)}`
    return null
}

/** Resolves when an engine progress stream (a pull or a build) finishes; rejects on a stream error. */
export function followProgress(
    client: Docker,
    stream: NodeJS.ReadableStream,
    onProgressLine?: (line: string) => void
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        client.modem.followProgress(
            stream,
            (error: Error | null) => {
                if (error) reject(error)
                else resolve()
            },
            (event: Record<string, unknown>) => {
                const line = progressLine(event)
                if (line !== null) onProgressLine?.(line)
            }
        )
    })
}
