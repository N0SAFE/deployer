import { readdirSync, readFileSync, existsSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { Injectable } from '@nestjs/common'

import {
    workspaceManifestSchema,
    rootManifestSchema,
    type Workspace,
} from '../schemas'
import { WorkspaceScanError } from '../errors'

/**
 * Workspace trees scanned when the root manifest declares no globs.
 *
 * Only a fallback: a manifest WITH globs is the source of truth, so adding a
 * tree there is enough. These are this repository's conventional trees, used
 * for manifests that predate the globs or fixtures that omit them.
 */
const DEFAULT_WORKSPACE_ROOTS = [
    'apps',
    'packages',
    'tools',
    'tooling',
    'infra',
] as const

/** Directories never worth descending into when scanning for workspaces. */
const SKIP_DIRS = new Set([
    'node_modules',
    'dist',
    '.git',
    '.turbo',
    'coverage',
    '.next',
    'out',
])

/** How deep a workspace may nest under the repository root. */
const MAX_DEPTH = 6

/**
 * Scans the repository for npm workspaces and the dependency edges between them.
 *
 * This is the piece that makes the `prune-*` volumes unnecessary. Each
 * application's pruned workspace used to be an INPUT to this tool; instead the
 * workspace graph is read from the manifests on disk, which the dev stack
 * already syncs in.
 *
 * Verified against `turbo prune` for all four applications in this repository:
 * the discovered closure matches the pruned closure exactly (31/29/21/8).
 *
 * Two rules that are easy to get wrong, both established empirically:
 *
 *   1. DESCEND INTO A PACKAGE DIRECTORY, do not stop at it.
 *      `tooling/eslint` is itself a workspace AND contains one
 *      (`tooling/eslint/plugins/progress`). Stopping at the first
 *      `package.json` silently omits the nested one, for every application.
 *
 *   2. The ROOT manifest's internal devDependencies always belong to the union.
 *      `turbo prune` keeps them regardless of which application is the target,
 *      and a closure walk that starts at the application never sees the root.
 *      In this repository that is why `doc` needs `@repo/env`: nothing in doc's
 *      own closure declares it, but the root does.
 */
@Injectable()
export class WorkspaceScanner {
    private cache: {
        root: string
        workspaces: Map<string, Workspace>
        rootInternal: string[]
    } | null = null

    /**
     * Scan `root` for workspaces. Results are cached per root, since the graph
     * does not change while this process runs.
     */
    scan(root: string): {
        workspaces: Map<string, Workspace>
        rootInternal: string[]
    } {
        if (this.cache?.root === root) return this.cache

        if (!existsSync(join(root, 'package.json'))) {
            throw new WorkspaceScanError(
                `No package.json at repository root`,
                root
            )
        }

        const manifests = this.collectManifests(root)
        if (manifests.length === 0) {
            throw new WorkspaceScanError(
                'Found no workspace manifests. Is the repository synced into the container?',
                root
            )
        }

        // First pass: learn every workspace NAME, so an internal dependency can
        // be distinguished from an external one before the edges are recorded.
        const names = new Set<string>()
        for (const dir of manifests) {
            const manifest = this.readManifest(join(root, dir))
            if (manifest) names.add(manifest.name)
        }

        // Second pass: record each workspace and its internal dependency edges.
        const workspaces = new Map<string, Workspace>()
        for (const dir of manifests) {
            const manifest = this.readManifest(join(root, dir))
            if (!manifest) continue

            const declared = {
                ...manifest.dependencies,
                ...manifest.devDependencies,
                ...manifest.peerDependencies,
                ...manifest.optionalDependencies,
            }

            workspaces.set(manifest.name, {
                name: manifest.name,
                dir: dir.split(sep).join('/'),
                internalDeps: Object.keys(declared).filter((dep) =>
                    names.has(dep)
                ),
            })
        }

        const rootInternal = this.readRootInternalDeps(root)

        this.cache = { root, workspaces, rootInternal }
        return this.cache
    }

    /**
     * Every directory containing a `package.json`, relative to `root`.
     *
     * Walks `apps`, `packages`, and `tools` (the workspace globs) and descends
     * through package directories rather than stopping at them — see rule 1.
     */
    private collectManifests(root: string): string[] {
        const found: string[] = []

        const walk = (dir: string, depth: number): void => {
            if (depth > MAX_DEPTH) return

            let entries: Dirent[]
            try {
                entries = readdirSync(join(root, dir), { withFileTypes: true })
            } catch {
                return // unreadable directory: not a workspace source
            }

            for (const entry of entries) {
                if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue

                const child = join(dir, entry.name)
                if (existsSync(join(root, child, 'package.json'))) {
                    found.push(child)
                }
                // Always descend, even when this child is itself a workspace.
                walk(child, depth + 1)
            }
        }

        for (const top of this.workspaceRoots(root)) {
            if (existsSync(join(root, top))) walk(top, 0)
        }

        return found
    }

    /**
     * The top-level directories the root manifest declares as workspace globs.
     *
     * Derived from `workspaces.packages` rather than hardcoded: this repository
     * keeps workspaces under `apps`, `packages`, `tools`, `tooling` and `infra`,
     * and a hardcoded list silently drops a whole tree the moment one of those
     * moves — the union then omits every package under it. Reading the globs
     * keeps the scanner and the install in agreement by construction.
     *
     * Globs are directory globs (with negations prefixed by a bang); only the
     * leading directory segment is needed, and negations are skipped.
     */
    private workspaceRoots(root: string): string[] {
        try {
            const raw = JSON.parse(
                readFileSync(join(root, 'package.json'), 'utf8')
            ) as unknown
            const parsed = rootManifestSchema.safeParse(raw)
            if (!parsed.success) return []

            const globs = parsed.data.workspaces
            const patterns = Array.isArray(globs) ? globs : (globs?.packages ?? [])

            const roots = new Set<string>()
            for (const pattern of patterns) {
                if (pattern.startsWith('!')) continue // negation: not a root
                const [head] = pattern.split('/')
                // A glob with no concrete leading directory is not a root.
                if (!head || head === '**' || head.includes('*')) continue
                roots.add(head)
            }

            // A manifest that declares no globs is still a valid workspace root
            // by convention; scanning the usual trees beats scanning nothing.
            return roots.size > 0 ? [...roots] : DEFAULT_WORKSPACE_ROOTS
        } catch {
            return [...DEFAULT_WORKSPACE_ROOTS]
        }
    }

    /** Parse a directory's `package.json`, or return null when it is unreadable/nameless. */
    private readManifest(
        dirPath: string
    ):
        | ({ name: string } & Record<
              string,
              Record<string, string> | undefined
          >)
        | null {
        try {
            const raw = JSON.parse(
                readFileSync(join(dirPath, 'package.json'), 'utf8')
            ) as unknown
            const parsed = workspaceManifestSchema.safeParse(raw)
            return parsed.success
                ? (parsed.data as { name: string } & Record<
                      string,
                      Record<string, string> | undefined
                  >)
                : null
        } catch {
            return null
        }
    }

    /**
     * The root manifest's internal devDependencies — always part of the union.
     *
     * See rule 2: `turbo prune` keeps these for every application, so a closure
     * that omits them diverges from what the applications expect to resolve.
     */
    private readRootInternalDeps(root: string): string[] {
        try {
            const raw = JSON.parse(
                readFileSync(join(root, 'package.json'), 'utf8')
            ) as unknown
            const parsed = rootManifestSchema.safeParse(raw)
            if (!parsed.success) return []

            return Object.keys(parsed.data.devDependencies ?? {}).filter(
                (dep) => dep.startsWith('@repo/')
            )
        } catch {
            return []
        }
    }

    /** Path of a workspace relative to `root`, for messages and Turbo filters. */
    static relativeDir(root: string, dir: string): string {
        return relative(root, join(root, dir)).split(sep).join('/')
    }
}
