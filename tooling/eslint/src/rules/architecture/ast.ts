import type { Rule } from 'eslint'

/**
 * The slice of an ESTree node these rules read. Bun's linter and `typescript-eslint` both produce ESTree, so the rules are
 * written against this structure once and receive nodes through `ast()` — one cast at the boundary instead of one per use.
 */
export interface AstNode {
    readonly type: string
    readonly name?: string
    readonly properties?: readonly AstNode[]
    readonly elements?: readonly (AstNode | null)[]
    readonly arguments?: readonly AstNode[]
    readonly decorators?: readonly { readonly expression?: AstNode }[]
    readonly callee?: AstNode
    readonly object?: AstNode
    readonly property?: AstNode
    readonly key?: AstNode
    readonly value?: AstNode
    readonly id?: AstNode
    readonly range?: readonly [number, number]
    readonly start?: number
}

export const ast = (node: unknown): AstNode => node as AstNode
/** Hand a node back to `context.report`. */
export const esNode = (node: AstNode): Rule.Node => node as unknown as Rule.Node

export const WRAPPERS: ReadonlySet<string> = new Set([
    'createModuleContext',
    'createGlobalModule',
    'declareModule',
])

export const startOf = (node: AstNode): number =>
    node.range?.[0] ?? node.start ?? 0

export function calleeName(node: AstNode): string | undefined {
    const callee = node.callee
    if (callee?.type === 'Identifier') return callee.name
    return callee?.type === 'MemberExpression'
        ? callee.property?.name
        : undefined
}

/** `{ provide: X }` → `X`, otherwise the identifier. */
export function entryName(node: AstNode): string | undefined {
    if (node.type === 'ObjectExpression')
        return node.properties?.find(
            (property) => property.key?.name === 'provide'
        )?.value?.name
    return node.name
}

export function arrayProperty(
    metadata: AstNode | undefined,
    name: string
): readonly AstNode[] {
    const property = metadata?.properties?.find(
        (candidate) => candidate.key?.name === name
    )
    if (property?.value?.type !== 'ArrayExpression') return []
    return (property.value.elements ?? []).filter(
        (element): element is AstNode => element !== null
    )
}

/**
 * The token names an array property lists, or `null` when they cannot be known from the syntax alone — a variable
 * (`providers: repositories`), a spread, a factory call (`effectHostProvider()`). `unknownExport` only judges what it can see
 * in full: guessing would flag every module that composes its providers, which is most of the monorepo.
 */
export function staticNames(
    metadata: AstNode | undefined,
    name: string
): Set<string> | null {
    const property = metadata?.properties?.find(
        (candidate) => candidate.key?.name === name
    )
    if (property === undefined) return new Set()
    if (property.value?.type !== 'ArrayExpression') return null

    const names = new Set<string>()
    for (const element of property.value.elements ?? []) {
        if (element === null) return null
        // `ConfigModule.forRoot(...)` hands up `ConfigModule`.
        const named =
            element.type === 'CallExpression' &&
            element.callee?.type === 'MemberExpression' &&
            element.callee.object !== undefined
                ? element.callee.object
                : element
        const entry = entryName(named)
        if (entry === undefined) return null
        // shortcut: PascalCase is a class token, camelCase a value (`apiEnvironmentProvider`) that may provide any token —
        // upgrade to a type lookup if the repo ever breaks the naming convention.
        if (
            name === 'providers' &&
            element.type === 'Identifier' &&
            /^[a-z]/.test(entry)
        )
            return null
        names.add(entry)
    }
    return names
}
