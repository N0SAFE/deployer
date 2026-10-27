import * as fs from 'node:fs'
import * as path from 'node:path'

import { walkFiles } from './glob'

/**
 * A path alias whose `*` points inside the package's own source tree.
 *
 * `tsc` writes import specifiers **verbatim**, so an alias that resolves
 * perfectly in source becomes an unresolvable specifier in `dist/types/**`:
 * `paths` is per-project, and a consumer has no `@/` mapping. The declarations
 * tree mirrors the source tree, so the repair is mechanical — replace the alias
 * with the relative path to the emitted `.d.ts`.
 *
 * Only aliases into the package's own source root are collected. An alias that
 * points outside the package is not this package's to rewrite; a consumer
 * resolves it through `exports`.
 */
export interface SourceAlias {
    /** Literal specifier prefix, e.g. `@/` — everything before the `*`. */
    readonly prefix: string
    /** Absolute directory the alias's `*` maps into. */
    readonly target: string
}

export interface AliasRewriteStats {
    /** Declaration files whose text changed. */
    readonly files: number
    /** Specifiers rewritten to a relative path. */
    readonly specifiers: number
    /** Aliased specifiers that matched no emitted declaration. */
    readonly unresolved: readonly string[]
}

/** `from '…'` — `import`, `export … from`, `export * from`, `import type`. */
const FROM_SPECIFIER = /(\bfrom\s*)(['"])([^'"]+)\2/g
/** `import('…')` — a dynamic import, or a `typeof import()` type reference. */
const DYNAMIC_IMPORT = /(\bimport\s*\(\s*)(['"])([^'"]+)\2/g
/** `import '…'` — a side-effect import. */
const BARE_IMPORT = /(^\s*import\s+)(['"])([^'"]+)\2/g

const PATTERNS = [FROM_SPECIFIER, DYNAMIC_IMPORT, BARE_IMPORT] as const

interface Context {
    readonly aliases: readonly SourceAlias[]
    readonly rootDir: string
    readonly typesDir: string
}

/**
 * A comment line's text is prose. `packages/auth` documents usage with example
 * imports inside JSDoc, and rewriting those would edit documentation, not code.
 */
function isCommentLine(line: string): boolean {
    const trimmed = line.trimStart()
    return (
        trimmed.startsWith('*') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*')
    )
}

/**
 * The relative specifier for one aliased specifier, or `null` when it does not
 * name an emitted declaration (a package-name alias, an escape from the source
 * root, or a path this package does not build).
 */
function toRelative(
    specifier: string,
    fromFile: string,
    { aliases, rootDir, typesDir }: Context
): string | null {
    for (const alias of aliases) {
        if (!specifier.startsWith(alias.prefix)) continue
        const rest = specifier.slice(alias.prefix.length)
        if (rest === '') return null

        // `@/entities/foo` -> `<pkg>/src/entities/foo` -> `<types>/entities/foo`.
        const sourcePath = path.join(alias.target, rest)
        const relFromRoot = path.relative(rootDir, sourcePath)
        const asFile = path.join(typesDir, `${relFromRoot}.d.ts`)
        const asIndex = path.join(typesDir, relFromRoot, 'index.d.ts')
        const hit = fs.existsSync(asFile)
            ? asFile
            : fs.existsSync(asIndex)
              ? asIndex
              : undefined
        if (hit === undefined) return null

        // Extensionless, and `…/index` collapses to the directory: TypeScript
        // resolves `./entities/foo` to `foo.d.ts` or `foo/index.d.ts` alike, so
        // the shortest form covers both and reads as the source alias did.
        let rel = path
            .relative(path.dirname(fromFile), hit)
            .split(path.sep)
            .join('/')
            .replace(/\.d\.ts$/, '')
        if (hit === asIndex) rel = rel.replace(/\/index$/, '')
        if (!rel.startsWith('.')) rel = `./${rel}`
        return rel
    }
    return null
}

function rewriteLine(
    line: string,
    fromFile: string,
    ctx: Context
): { line: string; count: number; unresolved: string[] } {
    if (isCommentLine(line)) return { line, count: 0, unresolved: [] }

    let count = 0
    const unresolved: string[] = []
    let out = line

    for (const pattern of PATTERNS) {
        out = out.replace(pattern, (match, lead: string, quote: string, spec: string) => {
            const rel = toRelative(spec, fromFile, ctx)
            if (rel === null) {
                // Only report an alias we own; a package-name import is expected
                // to resolve through `exports` and is left exactly as authored.
                if (ctx.aliases.some((alias) => spec.startsWith(alias.prefix))) {
                    unresolved.push(spec)
                }
                return match
            }
            count += 1
            return `${lead}${quote}${rel}${quote}`
        })
    }

    return { line: out, count, unresolved }
}

/**
 * Rewrite source aliases in every emitted declaration under `typesDir`.
 *
 * Runs after the declaration pass, so it sees the final tree — including the
 * authored `.d.ts` files copied in afterwards.
 */
export function rewriteDeclarationAliases(
    typesDir: string,
    rootDir: string,
    aliases: readonly SourceAlias[]
): AliasRewriteStats {
    if (aliases.length === 0 || !fs.existsSync(typesDir)) {
        return { files: 0, specifiers: 0, unresolved: [] }
    }

    const ctx: Context = { aliases, rootDir, typesDir }
    let files = 0
    let specifiers = 0
    const unresolved = new Set<string>()

    for (const rel of walkFiles(typesDir, (r) => r.endsWith('.d.ts'))) {
        const abs = path.join(typesDir, rel)
        const original = fs.readFileSync(abs, 'utf8')

        let changed = 0
        const lines = original.split('\n').map((line) => {
            const result = rewriteLine(line, abs, ctx)
            changed += result.count
            for (const specifier of result.unresolved) unresolved.add(specifier)
            return result.line
        })
        if (changed === 0) continue

        fs.writeFileSync(abs, lines.join('\n'))
        files += 1
        specifiers += changed
    }

    return { files, specifiers, unresolved: [...unresolved].sort() }
}
