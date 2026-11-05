import type { Rule } from 'eslint'

import {
    arrayProperty,
    ast,
    calleeName,
    entryName,
    esNode,
    startOf,
    staticNames,
    WRAPPERS,
} from './architecture/ast'
import type { AstNode } from './architecture/ast'
import {
    isUnsaved,
    loadFacts,
    parseOptions,
    realFile,
} from './architecture/facts-client'

/**
 * A module's Effect requirements, checked completely.
 *
 * A dependency a module cannot satisfy is reported at BOTH ends of the same gap:
 * - in the module, on the `providers` / `controllers` entry that needs it (`missingDependency`);
 * - in the file whose code USES the service — `yield* ReplicaStore` inside the provider — (`missingDependencyHere`),
 *   so the provider's author sees it without opening the module. That file must therefore be linted by this rule too.
 *
 * Plus two declaration checks that need only the syntax: an export that names nothing the module provides or imports
 * (`unknownExport`), and a token provided twice (`duplicateProvider`). They run only when `providers` and `imports` are fully
 * static, and stay silent otherwise — guessing would flag every module that composes its providers.
 *
 * Nothing is skipped silently: a file the gate could not analyse (`analysisFailed`), or a declaration it has no facts for
 * (`unanalysedCall`, `noFacts`), is an error. A gate that skips a file reads as a clean file.
 */
export const requirementFlow: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                "The module's Effect requirements, checked completely: unmet requirements (at the module and where the service is used), exports that name nothing the module provides or imports, and a token provided twice.",
        },
        schema: [
            {
                type: 'object',
                properties: {
                    root: { type: 'string' },
                    globs: { type: 'array', items: { type: 'string' } },
                },
                additionalProperties: false,
            },
        ],
        messages: {
            missingDependency:
                '`{{owner}}` requires `{{missing}}`, but module `{{module}}` neither provides it nor imports a module that exports it. Provide `{{missing}}` here or import the module that exports it.',
            missingDependencyHere:
                '`{{missing}}` is required here by `{{owner}}`, but module `{{module}}` ({{moduleFile}}) neither provides it nor imports a module that exports it.',
            unknownExport:
                "`{{name}}` is exported but neither provided nor imported by this module. An export must name one of `providers` or an imported module, or the type flow and Nest's container disagree.",
            duplicateProvider:
                '`{{name}}` is provided more than once in this module. The later provider silently replaces the earlier one, so the Effect context and Nest resolve different implementations.',
            analysisFailed:
                'The architecture gate could not analyse this file: {{reason}}',
            unanalysedCall:
                'The architecture gate has no analysis for this module declaration although the file was analysed. The compiler and the linter disagree about where it is; re-run the gate, and report it if it persists.',
            noFacts:
                "This file declares a module but the architecture gate has no analysis for it: it is outside the configured `globs`. Add it to the gate's scope — an unchecked module reads as a clean one.",
        },
    },

    create(context) {
        const file = realFile(context.filename)
        // Facts describe the file on disk; an unsaved buffer would be reported at the wrong place.
        if (isUnsaved(context.sourceCode.text, file)) return {}

        const facts = loadFacts(
            parseOptions(context.options[0] as unknown),
            context.cwd
        )
        const fileFacts = facts.files[file]
        const calls = new Map(
            (fileFacts?.calls ?? []).map((call) => [
                `${call.start.line}:${call.start.column}`,
                call,
            ])
        )
        // A globally exported service is visible everywhere; the root gate subtracts it (`ResolveGlobals`).
        const globals = new Set(facts.globals)
        const sourceCode = context.sourceCode

        return {
            Program() {
                const failures: readonly string[] = facts.errors[file] ?? []
                for (const reason of failures) {
                    // A file-level problem: pinned to the first character rather than to any one node.
                    context.report({
                        loc: { line: 1, column: 0 },
                        messageId: 'analysisFailed',
                        data: { reason },
                    })
                }
                for (const site of facts.sites[file] ?? []) {
                    if (globals.has(site.missing)) continue
                    // `column` is a UTF-16 index in both coordinate systems; that is what keeps this exact in files with accents or emoji.
                    context.report({
                        loc: {
                            start: {
                                line: site.start.line,
                                column: site.start.column,
                            },
                            end: {
                                line: site.end.line,
                                column: site.end.column,
                            },
                        },
                        messageId: 'missingDependencyHere',
                        data: {
                            owner: site.owner,
                            missing: site.missing,
                            module: site.module,
                            moduleFile: site.moduleFile.replace(
                                /^.*\/(?=(apps|packages|samples)\/)/,
                                ''
                            ),
                        },
                    })
                }
            },

            CallExpression(node) {
                const call = ast(node)
                if (!WRAPPERS.has(calleeName(call) ?? '')) return

                if (fileFacts === undefined) {
                    if (facts.errors[file] === undefined)
                        context.report({ node, messageId: 'noFacts' })
                    return
                }

                const metadata = call.arguments?.[0]
                const providers = arrayProperty(metadata, 'providers')
                const controllers = arrayProperty(metadata, 'controllers')

                // Syntactic checks: only when the module is declared as an object literal (`declareModule(Class, …)` has none).
                const providedNames = staticNames(metadata, 'providers')
                const importedNames = staticNames(metadata, 'imports')
                const seen = new Set<string>()
                for (const entry of providers) {
                    const name = entryName(entry)
                    if (name === undefined) continue
                    if (seen.has(name))
                        context.report({
                            node: esNode(entry),
                            messageId: 'duplicateProvider',
                            data: { name },
                        })
                    seen.add(name)
                }
                // An export names a provider, or re-exports a module listed in THIS module's `imports` (not any imported symbol).
                if (providedNames !== null && importedNames !== null) {
                    for (const entry of arrayProperty(metadata, 'exports')) {
                        const name = entryName(entry)
                        if (
                            name !== undefined &&
                            !providedNames.has(name) &&
                            !importedNames.has(name)
                        ) {
                            context.report({
                                node: esNode(entry),
                                messageId: 'unknownExport',
                                data: { name },
                            })
                        }
                    }
                }

                // Type flow: what the module's controllers/providers need and cannot see.
                const start = sourceCode.getLocFromIndex(startOf(call))
                const analysed = calls.get(`${start.line}:${start.column}`)
                if (analysed === undefined) {
                    context.report({ node, messageId: 'unanalysedCall' })
                    return
                }
                for (const [owner, missing] of analysed.pairs) {
                    if (globals.has(missing)) continue
                    const entry: AstNode | undefined = [
                        ...providers,
                        ...controllers,
                    ].find((candidate) => entryName(candidate) === owner)
                    context.report({
                        node: entry === undefined ? node : esNode(entry),
                        messageId: 'missingDependency',
                        data: { owner, missing, module: analysed.module },
                    })
                }
            },
        }
    },
}
