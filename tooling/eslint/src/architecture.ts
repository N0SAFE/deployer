/**
 * `deployer-effect` — the module-graph gate as an ESLint plugin (works under `bun lint` and the ESLint CLI/editor).
 *
 * The rules are type-aware, and types come from a separate process on the TypeScript 7.1 API (`architecture-facts`),
 * because neither Bun's linter nor a TS6 `typescript-eslint` program can answer them. See `tooling/eslint/AGENTS.md`.
 */
import type { ESLint } from 'eslint'

import { requireModuleContext } from './rules/require-module-context'
import { requirementFlow } from './rules/requirement-flow'

const plugin = {
    meta: { name: 'deployer-effect' },
    rules: { requireModuleContext, requirementFlow },
} satisfies ESLint.Plugin

export default plugin
