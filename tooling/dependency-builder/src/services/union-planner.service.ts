import { Injectable } from '@nestjs/common'

import { WorkspaceScanner } from './workspace-scanner.service'
import { UnknownWorkspaceError } from '../errors'
import { scopedLogger } from '../logger'
import type { UnionMember } from '../schemas'

/**
 * This tool's own workspace name.
 *
 * Its internal dependencies are always part of the union: the tool is started
 * from source but resolves `@repo/*` at runtime, so those packages have to be
 * built and published exactly like the applications' dependencies. Without this
 * the tool would be the one consumer missing from the graph it computes.
 */
export const SELF_PACKAGE = '@repo/dependency-builder'

/** How the tool names itself in the union's provenance log. */
export const SELF_CONTRIBUTOR = 'dependency-builder'

/**
 * Computes the union of internal packages the enabled applications require.
 *
 * This replaces the per-application prune volumes as the tool's INPUT. The
 * enabled applications are named by the caller (compose activates one service
 * per application, and each passes its workspace name); everything else is
 * derived from the manifests.
 *
 * Deduplication is inherent: the union is a Map keyed by package name, so a
 * package required by three applications appears once, with all three recorded
 * as contributors. That list is what the tool logs, and it is why "built once"
 * is true by construction rather than by a maintained list.
 *
 * The closure rule, verified against `turbo prune` for every application in this
 * repository:
 *
 *     closure(app) = reachable(app's internal deps) ∪ root internal devDeps
 *
 * Both halves are necessary. Dropping the root half loses `@repo/env`, which
 * `doc` needs and nothing in its own closure declares.
 */
@Injectable()
export class UnionPlanner {
    private readonly logger = scopedLogger(UnionPlanner.name)

    constructor(private readonly scanner: WorkspaceScanner) {}

    /**
     * Build the union for `applicationNames`.
     *
     * @param root Repository root, as mounted in this container.
     * @param applicationNames Workspace names of the ENABLED applications.
     */
    plan(root: string, applicationNames: readonly string[]): UnionMember[] {
        const { workspaces, rootInternal } = this.scanner.scan(root)

        if (applicationNames.length === 0) {
            throw new UnknownWorkspaceError('(none)', [...workspaces.keys()])
        }

        // Contributors per package, so the log can name every application that
        // pulled a package in.
        const contributors = new Map<string, Set<string>>()

        const add = (pkgName: string, app: string): void => {
            const existing = contributors.get(pkgName)
            if (existing) {
                existing.add(app)
                return
            }
            contributors.set(pkgName, new Set([app]))
        }

        for (const app of applicationNames) {
            if (!workspaces.has(app)) {
                throw new UnknownWorkspaceError(app, [...workspaces.keys()])
            }

            for (const pkgName of this.closureOf(
                app,
                workspaces,
                rootInternal
            )) {
                add(pkgName, app)
            }
        }

        // The tool's own dependencies, always. Skipped when the tool happens to
        // be one of the named applications, so its packages are not double-counted.
        if (!applicationNames.includes(SELF_PACKAGE)) {
            for (const pkgName of this.closureOf(
                SELF_PACKAGE,
                workspaces,
                rootInternal
            )) {
                add(pkgName, SELF_CONTRIBUTOR)
            }
        }

        const union: UnionMember[] = []
        for (const [name, apps] of contributors) {
            const workspace = workspaces.get(name)
            if (!workspace) continue // impossible: every name came from the graph
            union.push({
                name,
                dir: workspace.dir,
                contributors: [...apps].sort(),
            })
        }

        union.sort((a, b) => a.name.localeCompare(b.name))

        this.logger.info(
            `Union of ${String(union.length)} package(s) for ${String(applicationNames.length)} application(s)`
        )
        for (const member of union) {
            const shared = member.contributors.length > 1 ? '  (shared)' : ''
            this.logger.info(
                `  ${member.name}  <- ${member.contributors.join(', ')}${shared}`
            )
        }

        return union
    }

    /**
     * Everything reachable from `seed`'s internal dependencies, plus the root's.
     *
     * The seed itself is excluded: an application is not part of its own
     * dependency closure, and the applications run their own dev servers.
     */
    private closureOf(
        seed: string,
        workspaces: Map<string, { internalDeps: string[] }>,
        rootInternal: readonly string[]
    ): Set<string> {
        const seen = new Set<string>()
        const stack: string[] = [
            ...(workspaces.get(seed)?.internalDeps ?? []),
            ...rootInternal,
        ]

        while (stack.length > 0) {
            const current = stack.pop()
            if (current === undefined || seen.has(current) || current === seed)
                continue

            const workspace = workspaces.get(current)
            if (!workspace) continue // external package

            seen.add(current)
            for (const dep of workspace.internalDeps) stack.push(dep)
        }

        return seen
    }
}
