import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize } from 'node:path';
import type { BunPlugin } from 'bun';

/**
 * Bundle the ESLint toolchain's own TypeScript 6, and redirect every
 * `typescript` / `typescript/*` import to it.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * `typescript-eslint@8` peer-requires `typescript >=4.8.4 <6.1.0`, but every app
 * in this repo compiles against TypeScript 7. The two cannot be reconciled by
 * resolution alone: a consuming app that resolves `typescript` to its own TS7
 * would hand the bundled lint toolchain a compiler it does not support.
 *
 * So this plugin does two things:
 *
 *   1. redirects `typescript` and `typescript/*` to THIS package's TS6 copy;
 *   2. bundles TS6 plus the whole `typescript-eslint` /
 *      `@darraghor/eslint-plugin-nestjs-typed` runtime closure INTO the config
 *      bundle, so the app's TS7 is never reachable from the lint toolchain.
 *
 * Nothing outside that island is bundled: `packages: 'external'` is the base
 * rule, and only members of `bundledPackages` are overridden to be inlined.
 *
 * ── WHY IT LIVES IN SOURCE, NOT A SCRIPT ────────────────────────────────────
 * It used to be a standalone `build.ts` that called `Bun.build` itself. That is
 * now a `plugins: [...]` entry in `pkg-build.config.ts`, so the package builds
 * through the same pipeline as every other package and this plugin — the only
 * package-specific build logic in the repo — is a declared input rather than a
 * forked build script.
 */

const require = createRequire(import.meta.url);

interface PackageJson {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
}

interface PackageInfo {
    name: string;
    packageJsonPath: string;
    packageJson: PackageJson;
}

/**
 * The npm package name for a specifier.
 *
 *   typescript, typescript/lib/tsserverlibrary   -> typescript
 *   @typescript-eslint/parser, …/dist/index.js   -> @typescript-eslint/parser
 */
const getPackageName = (specifier: string): string | undefined => {
    if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('node:') ||
        specifier.startsWith('bun:')
    ) {
        return undefined;
    }
    if (specifier.startsWith('@')) {
        const parts = specifier.split('/');
        return parts.length < 2 ? undefined : `${parts[0]}/${parts[1]}`;
    }
    return specifier.split('/')[0];
};

/**
 * The `package.json` for a resolved file.
 *
 * Walks upward until the manifest's `name` matches: some packages ship nested
 * manifests inside their output (minimatch has one under `dist/commonjs/`), so
 * taking the nearest file would return the wrong package.
 */
const findPackageJson = (resolvedPath: string, expectedName: string): string => {
    let directory = dirname(resolvedPath);
    for (;;) {
        const packageJsonPath = join(directory, 'package.json');
        if (existsSync(packageJsonPath)) {
            try {
                const parsed = JSON.parse(
                    readFileSync(packageJsonPath, 'utf8'),
                ) as PackageJson;
                if (parsed.name === expectedName) return packageJsonPath;
            } catch {
                // Not a valid manifest; keep walking.
            }
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
    }
    throw new Error(
        [
            `Could not find package.json for "${expectedName}".`,
            '',
            `Resolved path: ${resolvedPath}`,
        ].join('\n'),
    );
};

const resolvePackage = (
    specifier: string,
    importerPath: string,
): string | undefined => {
    try {
        return require.resolve(specifier, { paths: [dirname(importerPath)] });
    } catch {
        return undefined;
    }
};

const packageInfoCache = new Map<string, PackageInfo>();

const getPackageInfo = (
    packageName: string,
    importerPath: string,
): PackageInfo | undefined => {
    const resolvedPath = resolvePackage(packageName, importerPath);
    if (!resolvedPath) return undefined;

    const packageJsonPath = findPackageJson(resolvedPath, packageName);
    const cached = packageInfoCache.get(packageJsonPath);
    if (cached) return cached;

    const packageJson = JSON.parse(
        readFileSync(packageJsonPath, 'utf8'),
    ) as PackageJson;
    if (!packageJson.name) {
        throw new Error(`Package at ${packageJsonPath} has no name.`);
    }
    const info: PackageInfo = { name: packageJson.name, packageJsonPath, packageJson };
    packageInfoCache.set(packageJsonPath, info);
    return info;
};

/**
 * TypeScript 6, resolved from THIS package.
 *
 * Asserted rather than assumed: if resolution ever picks up the app's TypeScript
 * the whole island is defeated, and that failure would otherwise surface as an
 * obscure error deep inside typescript-eslint.
 */
const typescript6Path = require.resolve('typescript');
const typescript6PackageJsonPath = findPackageJson(typescript6Path, 'typescript');
const typescript6PackageJson = JSON.parse(
    readFileSync(typescript6PackageJsonPath, 'utf8'),
) as PackageJson;

if (
    typescript6PackageJson.name !== 'typescript' ||
    !typescript6PackageJson.version?.startsWith('6.')
) {
    throw new Error(
        [
            'Expected TypeScript 6 but resolved another version.',
            '',
            `Path: ${typescript6Path}`,
            `Version: ${typescript6PackageJson.version ?? 'unknown'}`,
        ].join('\n'),
    );
}

const typescript6Root = dirname(typescript6PackageJsonPath);

/**
 * Roots whose COMPLETE runtime dependency closure is bundled.
 *
 * Peer dependencies are deliberately not traversed — they are supplied by the
 * consuming environment. TypeScript is the exception: it is a peer of
 * typescript-eslint but must come from this bundle.
 */
const ts6RootPackages = [
    'typescript-eslint',
    '@darraghor/eslint-plugin-nestjs-typed',
] as const;

const bundledPackages = new Set<string>(['typescript']);

const collectPackageDependencies = (
    packageName: string,
    importerPath: string,
): void => {
    if (packageName === 'typescript') {
        bundledPackages.add('typescript');
        return;
    }

    const packageInfo = getPackageInfo(packageName, importerPath);
    // Unresolvable: let the bundler handle and report it.
    if (!packageInfo) return;
    if (bundledPackages.has(packageInfo.name)) return;

    bundledPackages.add(packageInfo.name);

    const runtimeDependencies = {
        ...(packageInfo.packageJson.dependencies ?? {}),
        ...(packageInfo.packageJson.optionalDependencies ?? {}),
    };
    for (const dependencyName of Object.keys(runtimeDependencies)) {
        collectPackageDependencies(dependencyName, packageInfo.packageJsonPath);
    }
};

for (const rootPackage of ts6RootPackages) {
    collectPackageDependencies(rootPackage, import.meta.filename);
}

/** Redirect `typescript` and `typescript/*` to this package's TS6 copy. */
const resolveTypescriptToTs6 = (args: { path: string; importer: string }): { path: string; external: false } | undefined => {
    if (args.path === 'typescript') {
        return { path: typescript6Path, external: false };
    }
    const subpath = args.path.slice('typescript/'.length);
    const candidatePath = normalize(join(typescript6Root, subpath));
    let resolvedPath: string;
    try {
        resolvedPath = require.resolve(candidatePath);
    } catch (error) {
        throw new Error(
            [
                `Could not resolve TypeScript 6 subpath: ${args.path}`,
                '',
                `TS6 root: ${typescript6Root}`,
                `Candidate: ${candidatePath}`,
                `Importer: ${args.importer}`,
                '',
                error instanceof Error ? error.message : String(error),
            ].join('\n'),
        );
    }
    return { path: resolvedPath, external: false };
};

/** Inline the island's packages; leave everything else to `packages: 'external'`. */
const inlineIslandPackage = (specifier: string, importer: string): { path: string; external: false } | undefined => {
    const packageName = getPackageName(specifier);
    if (!packageName || !bundledPackages.has(packageName)) return undefined;

    const resolvedPath = resolvePackage(specifier, importer);
    if (!resolvedPath) {
        throw new Error(
            [`Could not resolve bundled dependency: ${specifier}`, '', `Importer: ${importer}`].join('\n'),
        );
    }
    return { path: resolvedPath, external: false };
};

/**
 * The plugin, applied to every `bun build` pass for this package.
 *
 * `packages: 'external'` remains the base rule; only island members are inlined.
 */
export const bundleTs6Island: BunPlugin = {
    name: 'bundle-typescript-6-island',
    setup(build) {
        build.onResolve({ filter: /^typescript(?:\/.*)?$/ }, (args) =>
            resolveTypescriptToTs6(args),
        );

        build.onResolve({ filter: /.*/ }, (args) => {
            // Local files and builtins resolve normally.
            if (
                args.path.startsWith('.') ||
                args.path.startsWith('/') ||
                args.path.startsWith('node:') ||
                args.path.startsWith('bun:')
            ) {
                return undefined;
            }
            // Handled by the dedicated resolver above.
            if (/^typescript(?:\/.*)?$/.test(args.path)) return undefined;

            return inlineIslandPackage(args.path, args.importer);
        });
    },
};

export default bundleTs6Island;
