import z from 'zod/v4'

/**
 * The contract between the facts process (`architecture-facts`) and the rules.
 *
 * The child prints JSON and the rules read it: that is a trust boundary, so it is parsed with this ONE schema and the types
 * are inferred from it — a field added on one side and forgotten on the other fails at parse time with the field named,
 * not as a silently missing finding.
 *
 * Positions are `{ line, column }` (1-based line, 0-based UTF-16 column), the same coordinates ESLint reports in. A raw
 * character offset would be wrong the moment the linter and the compiler disagree about encoding.
 */
export const positionSchema = z.object({
    line: z.number().int().min(1),
    column: z.number().int().min(0),
})
export type Position = z.infer<typeof positionSchema>

/** `[owner, missing]`: `owner` is a provider/controller of the module, `missing` a service it needs and cannot see. */
const pairSchema = z.tuple([z.string(), z.string()])

/** One `createModuleContext` / `createGlobalModule` / `declareModule` call. `pairs` is empty when nothing is unmet. */
const callFactsSchema = z.object({
    start: positionSchema,
    module: z.string(),
    pairs: z.array(pairSchema),
})
export type CallFacts = z.infer<typeof callFactsSchema>

const fileFactsSchema = z.object({
    /** `@Module` classes that carry no `ExportsOf` phantom type. */
    bare: z.array(z.string()),
    calls: z.array(callFactsSchema),
})
export type FileFacts = z.infer<typeof fileFactsSchema>

/** Where code USES a service its module does not provide — reported in the file that uses it. */
const siteSchema = z.object({
    start: positionSchema,
    end: positionSchema,
    owner: z.string(),
    missing: z.string(),
    module: z.string(),
    moduleFile: z.string(),
})
export type Site = z.infer<typeof siteSchema>

export const factsSchema = z.object({
    files: z.record(z.string(), fileFactsSchema),
    /** Services exported by a global module: visible everywhere, so never a requirement. */
    globals: z.array(z.string()),
    sites: z.record(z.string(), z.array(siteSchema)),
    /** Files the gate could not analyse. A gate that skips is worse than one that fails, so these are reported. */
    errors: z.record(z.string(), z.array(z.string())),
})
export type Facts = z.infer<typeof factsSchema>

/** The rule options: where the module files are. The default is the monorepo (`cwd`, `apps` + `packages`). */
export const gateOptionsSchema = z.strictObject({
    root: z.string().optional(),
    globs: z.array(z.string()).optional(),
})
export type GateOptions = z.infer<typeof gateOptionsSchema>

/** `.module.ts` files always count; any other file only when it declares a module (`createModuleContext(`, `@Module(`, …). */
export const DEFAULT_GLOBS = [
    'apps/**/src/**/*.ts',
    'packages/**/src/**/*.ts',
] as const
