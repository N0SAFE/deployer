import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * Recursive file scan returning POSIX-relative paths, sorted.
 *
 * The builder only ever needs "all files under X matching extension(s)", which
 * this covers with `node:fs` instead of `Bun.Glob`. Keeping the config/layout
 * layer runtime-agnostic is what lets its unit tests run under vitest (node),
 * where the `bun` virtual module does not resolve. Directories that can never
 * contain build inputs (`node_modules`, dot-directories) are skipped, matching
 * the watcher's ignore rule.
 */
export function walkFiles(
    root: string,
    matches: (rel: string) => boolean
): string[] {
    const found: string[] = []

    const visit = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.'))
                    continue
                visit(path.join(dir, entry.name))
                continue
            }
            if (!entry.isFile()) continue
            const rel = path
                .relative(root, path.join(dir, entry.name))
                .split(path.sep)
                .join('/')
            if (matches(rel)) found.push(rel)
        }
    }

    visit(root)
    return found.sort()
}
