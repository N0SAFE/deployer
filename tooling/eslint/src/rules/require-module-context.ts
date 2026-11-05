import type { Rule } from 'eslint'

import { ast, esNode } from './architecture/ast'
import {
    isUnsaved,
    loadFacts,
    parseOptions,
    realFile,
} from './architecture/facts-client'

/**
 * Every `@Module` must be produced by `createModuleContext` / `createGlobalModule` / `declareModule`.
 *
 * The wrapper is what attaches `[EffectContextOf]` / `[ExportsOf]` / `[UnmetRequirementsOf]`; a bare `@Module` carries none of
 * them, so importing it contributes `never` and its services are invisible to the type flow. The failure then surfaces at
 * the composition root as `Missing<...>`, three files from the cause. This reports it where the class is declared.
 *
 * Type-aware: the answer comes from the facts process (TypeScript 7.1), not from the linter.
 */
export const requireModuleContext: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Every module must be produced by createModuleContext/createGlobalModule/declareModule, so its services are visible to the type flow.',
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
            bareModule:
                '`{{name}}` is a bare `@Module`. Declare it with `createModuleContext({...})` / `createGlobalModule({...})`, or wrap it with `declareModule({{name}}, { provides, exports })` — otherwise its services contribute nothing to the Effect context and the failure appears at the root as `Missing<...>`.',
            noFacts:
                "`{{name}}` is a `@Module` the gate has no analysis for: its file is outside the configured `globs` or was not analysed. Add the file to the gate's scope — an unchecked module reads as a clean one.",
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

        return {
            ClassDeclaration(node) {
                const cls = ast(node)
                const name = cls.id?.name
                if (name === undefined) return
                const isModule = (cls.decorators ?? []).some(
                    (decorator) =>
                        decorator.expression?.type === 'CallExpression' &&
                        decorator.expression.callee?.name === 'Module'
                )
                if (!isModule) return

                if (fileFacts === undefined) {
                    // Reported by `requirementFlow` already when the file failed analysis; this is the "never in scope" case.
                    if (facts.errors[file] === undefined)
                        context.report({
                            node: esNode(cls.id as never),
                            messageId: 'noFacts',
                            data: { name },
                        })
                    return
                }
                if (fileFacts.bare.includes(name))
                    context.report({
                        node: esNode(cls.id as never),
                        messageId: 'bareModule',
                        data: { name },
                    })
            },
        }
    },
}
