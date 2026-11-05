import { describe, expect, it } from 'vitest'

import {
    buildInteractiveShellCommand,
    escapeShellArg,
    isRecoverableAttachError,
    logMatchesProcess,
    mapProcessState,
    normalizeContainerPath,
    parseListEntry,
    parsePercent,
    parseTimestampedLogLine,
    toTerminalChunk,
} from './container-runtime-helpers'

describe('container runtime helpers', () => {
    it('quotes a shell argument so an embedded quote cannot escape it', () => {
        expect(escapeShellArg('plain')).toBe("'plain'")
        expect(escapeShellArg("it's")).toBe(`'it'"'"'s'`)
        expect(buildInteractiveShellCommand('bash', '/app dir')).toEqual([
            'sh',
            '-lc',
            "cd '/app dir' && exec bash -i",
        ])
    })

    it('normalizes a container path to an absolute, collapsed one', () => {
        expect(normalizeContainerPath(' app/../data//x ')).toBe('/data/x')
        expect(normalizeContainerPath('/a/./b')).toBe('/a/b')
    })

    it('splits a docker log line into its timestamp and message', () => {
        const fallback = '2026-01-01T00:00:00.000Z'
        expect(
            parseTimestampedLogLine(
                '2026-10-01T10:00:00.000Z hello world',
                fallback
            )
        ).toEqual({
            timestamp: '2026-10-01T10:00:00.000Z',
            message: 'hello world',
        })
        expect(parseTimestampedLogLine('no timestamp here', fallback)).toEqual({
            timestamp: fallback,
            message: 'no timestamp here',
        })
        expect(parseTimestampedLogLine('   ', fallback)).toEqual({
            timestamp: fallback,
            message: '',
        })
    })

    it('maps a ps state letter and bounds a cpu or memory percentage', () => {
        expect(mapProcessState('R+')).toBe('running')
        expect(mapProcessState('Ss')).toBe('sleeping')
        expect(mapProcessState('T')).toBe('stopped')
        expect(mapProcessState('Z')).toBe('zombie')
        expect(mapProcessState('?')).toBe('idle')
        expect(parsePercent('12.5%')).toBe(12.5)
        expect(parsePercent('250')).toBe(100)
        expect(parsePercent(undefined)).toBe(0)
    })

    it('matches a process id as a word or in brackets in a log message', () => {
        expect(logMatchesProcess('worker [42] started', '42')).toBe(true)
        expect(logMatchesProcess('pid 42 exited', '42')).toBe(true)
        expect(logMatchesProcess('port 4242', '42')).toBe(false)
    })

    it('treats socket, hijack and timeout failures as recoverable attach errors', () => {
        expect(isRecoverableAttachError(new Error('socket hang up'))).toBe(true)
        expect(isRecoverableAttachError(new Error('ECONNRESET'))).toBe(true)
        expect(isRecoverableAttachError(new Error('permission denied'))).toBe(
            false
        )
    })

    it('decodes terminal chunks from strings, buffers and arrays', () => {
        expect(toTerminalChunk('abc')).toBe('abc')
        expect(toTerminalChunk(Buffer.from('héllo'))).toBe('héllo')
    })

    it('reads a directory listing line into a file entry, or nothing for noise', () => {
        const at = '2026-10-01T00:00:00.000Z'
        expect(parseListEntry('', '/app', at)).toBeNull()
        expect(
            parseListEntry(
                'drwxr-xr-x 2 root root 4096 Oct 1 10:00 .',
                '/app',
                at
            )
        ).toBeNull()
        expect(
            parseListEntry(
                '-rw-r--r-- 1 app app 120 Oct 1 10:00 my file.txt',
                '/app',
                at
            )
        ).toMatchObject({
            path: '/app/my file.txt',
            type: 'file',
            size: '120 B',
            owner: 'app',
        })
        expect(
            parseListEntry(
                'drwxr-xr-x 2 root root 4096 Oct 1 10:00 logs',
                '/',
                at
            )
        ).toMatchObject({ path: '/logs', type: 'dir' })
    })
})
