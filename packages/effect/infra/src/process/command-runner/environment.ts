import { Redacted } from 'effect'

import { CommandError, ExeNotAllowed, InvalidCommand } from './errors'
import { MIN_SECRET_LENGTH } from './limits'
import { Command } from './types'

export const unwrapEnv = (
    env: Command['env'],
    inheritEnv: boolean
): {
    readonly env: Record<string, string>
    readonly secrets: readonly string[]
} => {
    const ambient = Object.entries(Bun.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
    )
    // PATH is the one ambient variable a child needs to resolve bare executable names.
    const out: Record<string, string> = Object.fromEntries(
        inheritEnv ? ambient : ambient.filter(([key]) => key === 'PATH')
    )
    const secrets: string[] = []
    for (const [key, value] of Object.entries(env ?? {})) {
        if (typeof value === 'string') {
            out[key] = value
        } else {
            const unwrapped = Redacted.value(value)
            out[key] = unwrapped
            if (unwrapped.length >= MIN_SECRET_LENGTH) secrets.push(unwrapped)
        }
    }
    return { env: out, secrets }
}

export const scrubWith =
    (secrets: readonly string[]) =>
    (text: string): string =>
        secrets.reduce(
            (acc, secret) => acc.split(secret).join('[redacted]'),
            text
        )

export const validate = (
    command: Command,
    allow: ReadonlySet<string>
): CommandError | undefined => {
    if (command.exe.length === 0)
        return new InvalidCommand({ reason: 'empty executable' })
    if (!allow.has(command.exe)) return new ExeNotAllowed({ exe: command.exe })
    if (
        command.exe.includes('\0') ||
        command.args.some((arg) => arg.includes('\0'))
    ) {
        return new InvalidCommand({ reason: 'NUL byte in command' })
    }
    return undefined
}
