import * as fs from 'node:fs'

/**
 * Remove comments and trailing commas from a tsconfig/JSONC file.
 *
 * Must be string-aware: a naive regex sees `/*` inside `"../*"` as the start of
 * a block comment and eats the rest of the file.
 */
export function stripJsonComments(input: string): string {
    let out = ''
    let inString = false
    let inLine = false
    let inBlock = false
    let escaped = false

    for (let i = 0; i < input.length; i += 1) {
        const char = input[i]!
        const next = input[i + 1]

        if (inLine) {
            if (char === '\n') {
                inLine = false
                out += char
            }
            continue
        }
        if (inBlock) {
            if (char === '*' && next === '/') {
                inBlock = false
                i += 1
            }
            continue
        }
        if (inString) {
            out += char
            if (escaped) escaped = false
            else if (char === '\\') escaped = true
            else if (char === '"') inString = false
            continue
        }
        if (char === '"') {
            inString = true
            out += char
            continue
        }
        if (char === '/' && next === '/') {
            inLine = true
            i += 1
            continue
        }
        if (char === '/' && next === '*') {
            inBlock = true
            i += 1
            continue
        }
        out += char
    }
    return out.replace(/,\s*([}\]])/g, '$1')
}

export function readJson(file: string): Record<string, unknown> {
    return JSON.parse(
        stripJsonComments(fs.readFileSync(file, 'utf8'))
    ) as Record<string, unknown>
}
