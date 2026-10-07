/**
 * Zod schemas for the data this tool reads and produces.
 *
 * Every value it consumes from disk is parsed, never asserted: a malformed
 * manifest must produce a named error rather than an `undefined` that surfaces
 * three steps later as a missing package.
 */
import zod from 'zod/v4'

/** The subset of a package.json the dependency graph needs. */
export const workspaceManifestSchema = zod.object({
    name: zod.string().min(1),
    version: zod.string().optional(),
    private: zod.boolean().optional(),
    dependencies: zod.record(zod.string(), zod.string()).optional(),
    devDependencies: zod.record(zod.string(), zod.string()).optional(),
    peerDependencies: zod.record(zod.string(), zod.string()).optional(),
    optionalDependencies: zod.record(zod.string(), zod.string()).optional(),
})

export type WorkspaceManifest = zod.infer<typeof workspaceManifestSchema>

/** The root manifest, from which the always-kept internal devDependencies come. */
export const rootManifestSchema = zod.object({
    devDependencies: zod.record(zod.string(), zod.string()).optional(),
    /**
     * The workspace globs, in either supported shape: a bare array, or the
     * object form (`{ packages: [...] }`) this repository uses to carry
     * `catalogs` alongside them. The scanner derives its walk roots from these
     * rather than hardcoding directory names, so moving a workspace tree cannot
     * silently drop it from the union.
     */
    workspaces: zod
        .union([
            zod.array(zod.string()),
            zod.object({ packages: zod.array(zod.string()) }),
        ])
        .optional(),
})

/**
 * One workspace found on disk.
 *
 * `dir` is relative to the repository root and uses forward slashes, so the
 * value is stable regardless of platform.
 */
export const workspaceSchema = zod.object({
    name: zod.string(),
    dir: zod.string(),
    /** Internal workspace dependencies (`@repo/*`) declared by this workspace. */
    internalDeps: zod.array(zod.string()),
})

export type Workspace = zod.infer<typeof workspaceSchema>

/** A package that will be built, and which applications pulled it in. */
export const unionMemberSchema = zod.object({
    name: zod.string(),
    /** Repository-relative directory, for logging and Turbo's scope. */
    dir: zod.string(),
    /** Applications whose closure includes this package. Sorted. */
    contributors: zod.array(zod.string()),
})

export type UnionMember = zod.infer<typeof unionMemberSchema>
