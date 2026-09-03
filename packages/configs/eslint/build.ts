/**
 * Build script for @repo/config-eslint.
 *
 * Goal:
 *
 *   Application
 *     └── typescript@7
 *
 *   @repo/config-eslint
 *     ├── TypeScript 6 bundled
 *     ├── typescript-eslint bundled
 *     ├── @typescript-eslint/* bundled
 *     ├── @darraghor/eslint-plugin-nestjs-typed bundled
 *     └── all runtime dependencies of the above bundled
 *
 * Everything outside that dependency island remains external.
 *
 * The important part is that every:
 *
 *   typescript
 *   typescript/*
 *
 * import is redirected to the TypeScript 6 package belonging to this
 * workspace, so the consuming application's TypeScript 7 can never be used
 * by the bundled ESLint toolchain.
 */

import {
    existsSync,
    mkdirSync,
    readFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
    dirname,
    join,
    normalize,
} from "node:path";
import type { BunPlugin } from "bun";

const require = createRequire(import.meta.url);

/**
 * --------------------------------------------------------------------------
 * Entrypoints
 * --------------------------------------------------------------------------
 */

const entrypoints = [
    "./src/index.ts",
    "./src/library.ts",
    "./src/nextjs.ts",
    "./src/nestjs.ts",
    "./src/react.ts",
];

/**
 * --------------------------------------------------------------------------
 * Types
 * --------------------------------------------------------------------------
 */

type PackageJson = {
    name?: string;
    version?: string;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
};

type PackageInfo = {
    name: string;
    version: string;
    packageJsonPath: string;
    packageDirectory: string;
    packageJson: PackageJson;
};

/**
 * --------------------------------------------------------------------------
 * Package helpers
 * --------------------------------------------------------------------------
 */

/**
 * Extract the npm package name from a package specifier.
 *
 * Examples:
 *
 *   typescript
 *   typescript/lib/tsserverlibrary
 *   @typescript-eslint/parser
 *   @typescript-eslint/parser/dist/index.js
 */
const getPackageName = (
    specifier: string,
): string | undefined => {
    if (
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        specifier.startsWith("node:") ||
        specifier.startsWith("bun:")
    ) {
        return undefined;
    }

    if (specifier.startsWith("@")) {
        const parts = specifier.split("/");

        if (parts.length < 2) {
            return undefined;
        }

        return `${parts[0]}/${parts[1]}`;
    }

    return specifier.split("/")[0];
};

/**
 * Find the package.json belonging to a resolved file.
 *
 * Some packages have nested package.json files inside their build output.
 * For example, minimatch can contain:
 *
 *   minimatch/package.json
 *   minimatch/dist/commonjs/package.json
 *
 * Therefore we walk upward until we find the package.json whose "name"
 * matches the package we're looking for.
 */
const findPackageJson = (
    resolvedPath: string,
    expectedPackageName: string,
): string => {
    let directory = dirname(resolvedPath);

    while (true) {
        const packageJsonPath = join(
            directory,
            "package.json",
        );

        if (existsSync(packageJsonPath)) {
            try {
                const packageJson = JSON.parse(
                    readFileSync(
                        packageJsonPath,
                        "utf8",
                    ),
                ) as PackageJson;

                if (
                    packageJson.name === expectedPackageName
                ) {
                    return packageJsonPath;
                }
            } catch {
                // Ignore files that are not valid package manifests.
            }
        }

        const parent = dirname(directory);

        if (parent === directory) {
            break;
        }

        directory = parent;
    }

    throw new Error(
        [
            `Could not find package.json for "${expectedPackageName}".`,
            "",
            `Resolved path: ${resolvedPath}`,
        ].join("\n"),
    );
};

const resolvePackage = (
    packageSpecifier: string,
    importerPath: string,
): string | undefined => {
    try {
        return require.resolve(
            packageSpecifier,
            {
                paths: [
                    dirname(importerPath),
                ],
            },
        );
    } catch {
        return undefined;
    }
};

const packageInfoCache = new Map<string, PackageInfo>();

const getPackageInfo = (
    packageName: string,
    importerPath: string,
): PackageInfo | undefined => {
    const resolvedPath = resolvePackage(
        packageName,
        importerPath,
    );

    if (!resolvedPath) {
        return undefined;
    }

    const packageJsonPath = findPackageJson(
        resolvedPath,
        packageName,
    );

    const cached = packageInfoCache.get(
        packageJsonPath,
    );

    if (cached) {
        return cached;
    }

    const packageJson = JSON.parse(
        readFileSync(
            packageJsonPath,
            "utf8",
        ),
    ) as PackageJson;

    if (!packageJson.name) {
        throw new Error(
            `Package at ${packageJsonPath} has no name.`,
        );
    }

    const info: PackageInfo = {
        name: packageJson.name,
        version: packageJson.version ?? "unknown",
        packageJsonPath,
        packageDirectory: dirname(packageJsonPath),
        packageJson,
    };

    packageInfoCache.set(
        packageJsonPath,
        info,
    );

    return info;
};

/**
 * --------------------------------------------------------------------------
 * Resolve TypeScript 6
 * --------------------------------------------------------------------------
 */

const typescript6Path = require.resolve(
    "typescript",
);

const typescript6PackageJsonPath =
    findPackageJson(
        typescript6Path,
        "typescript",
    );

const typescript6PackageJson = JSON.parse(
    readFileSync(
        typescript6PackageJsonPath,
        "utf8",
    ),
) as PackageJson;

if (
    typescript6PackageJson.name !== "typescript" ||
    !typescript6PackageJson.version?.startsWith("6.")
) {
    throw new Error(
        [
            "Expected TypeScript 6 but resolved another version.",
            "",
            `Path: ${typescript6Path}`,
            `Package: ${typescript6PackageJson.name ?? "unknown"}`,
            `Version: ${typescript6PackageJson.version ?? "unknown"}`,
        ].join("\n"),
    );
}

const typescript6Root = dirname(
    typescript6PackageJsonPath,
);

console.log(
    `Using TypeScript ${typescript6PackageJson.version}`,
);

console.log(
    `  ${typescript6Path}`,
);

/**
 * --------------------------------------------------------------------------
 * Dependency island
 * --------------------------------------------------------------------------
 *
 * These are the roots whose complete runtime dependency closure is bundled.
 *
 * Peer dependencies are intentionally NOT traversed.
 *
 * TypeScript is the special case: it is a peer dependency of typescript-eslint
 * but must be provided by this bundle as TS6.
 */
const ts6RootPackages = [
    "typescript-eslint",
    "@darraghor/eslint-plugin-nestjs-typed",
] as const;

const bundledPackages = new Set<string>([
    "typescript",
]);

const collectPackageDependencies = (
    packageName: string,
    importerPath: string,
): void => {
    /**
     * TypeScript is always our local TS6.
     */
    if (packageName === "typescript") {
        bundledPackages.add("typescript");
        return;
    }

    const packageInfo = getPackageInfo(
        packageName,
        importerPath,
    );

    if (!packageInfo) {
        /**
         * Let Bun handle/report unresolved packages.
         */
        return;
    }

    if (
        bundledPackages.has(packageInfo.name)
    ) {
        return;
    }

    bundledPackages.add(packageInfo.name);

    /**
     * Bundle normal runtime dependencies.
     *
     * Do NOT traverse peerDependencies because those are intentionally
     * supplied by the consuming environment.
     */
    const runtimeDependencies = {
        ...(packageInfo.packageJson.dependencies ?? {}),
        ...(packageInfo.packageJson.optionalDependencies ?? {}),
    };

    for (
        const dependencyName of Object.keys(
            runtimeDependencies,
        )
    ) {
        collectPackageDependencies(
            dependencyName,
            packageInfo.packageJsonPath,
        );
    }
};

/**
 * Build the complete dependency closure.
 */
for (
    const rootPackage of ts6RootPackages
) {
    collectPackageDependencies(
        rootPackage,
        import.meta.filename,
    );
}

console.log("");
console.log(
    "Bundled ESLint / TypeScript 6 dependency island:",
);

for (
    const packageName of [
        ...bundledPackages,
    ].sort()
) {
    console.log(`  ${packageName}`);
}

console.log("");

/**
 * --------------------------------------------------------------------------
 * Bun plugin
 * --------------------------------------------------------------------------
 *
 * Base mode:
 *
 *   packages: "external"
 *
 * Therefore npm packages are external by default.
 *
 * We selectively override that behavior for the dependency island.
 */
const bundleTs6Island: BunPlugin = {
    name: "bundle-typescript-6-island",

    setup(build) {
        /**
         * ------------------------------------------------------------------
         * TypeScript root + subpaths
         * ------------------------------------------------------------------
         *
         * Handles ALL of:
         *
         *   typescript
         *   typescript/lib/typescript
         *   typescript/lib/tsserverlibrary
         *   typescript/lib/tsc
         *   ...
         *
         * This is necessary because typescript-eslint currently imports
         * TypeScript compiler subpaths directly.
         */
        build.onResolve(
            {
                filter: /^typescript(?:\/.*)?$/,
            },
            (args) => {
                /**
                 * `import "typescript"`
                 */
                if (
                    args.path === "typescript"
                ) {
                    return {
                        path: typescript6Path,
                        external: false,
                    };
                }

                /**
                 * `import "typescript/<subpath>"`
                 */
                const subpath =
                    args.path.slice(
                        "typescript/".length,
                    );

                /**
                 * Resolve the subpath inside the TS6 package.
                 *
                 * Example:
                 *
                 *   typescript/lib/tsserverlibrary
                 *
                 * becomes:
                 *
                 *   /.../typescript@6.x/.../lib/tsserverlibrary
                 */
                const candidatePath = normalize(
                    join(
                        typescript6Root,
                        subpath,
                    ),
                );

                let resolvedPath: string;

                try {
                    resolvedPath = require.resolve(
                        candidatePath,
                    );
                } catch (error) {
                    throw new Error(
                        [
                            `Could not resolve TypeScript 6 subpath: ${args.path}`,
                            "",
                            `TS6 root: ${typescript6Root}`,
                            `Candidate: ${candidatePath}`,
                            "",
                            `Importer: ${args.importer}`,
                            "",
                            error instanceof Error
                                ? error.message
                                : String(error),
                        ].join("\n"),
                    );
                }

                return {
                    path: resolvedPath,
                    external: false,
                };
            },
        );

        /**
         * ------------------------------------------------------------------
         * All packages in the TS6 dependency island
         * ------------------------------------------------------------------
         */
        build.onResolve(
            {
                filter: /.*/,
            },
            (args) => {
                /**
                 * Local files and builtin modules should be handled normally.
                 */
                if (
                    args.path.startsWith(".") ||
                    args.path.startsWith("/") ||
                    args.path.startsWith("node:") ||
                    args.path.startsWith("bun:")
                ) {
                    return undefined;
                }

                /**
                 * TypeScript and TypeScript subpaths are handled by the
                 * dedicated resolver above.
                 */
                if (
                    /^typescript(?:\/.*)?$/.test(
                        args.path,
                    )
                ) {
                    return undefined;
                }

                const packageName =
                    getPackageName(
                        args.path,
                    );

                if (!packageName) {
                    return undefined;
                }

                /**
                 * Bundle everything belonging to the TS6 dependency island.
                 */
                if (
                    bundledPackages.has(
                        packageName,
                    )
                ) {
                    const resolvedPath =
                        resolvePackage(
                            args.path,
                            args.importer,
                        );

                    if (!resolvedPath) {
                        throw new Error(
                            [
                                `Could not resolve bundled dependency: ${args.path}`,
                                "",
                                `Importer: ${args.importer}`,
                            ].join("\n"),
                        );
                    }

                    return {
                        path: resolvedPath,
                        external: false,
                    };
                }

                /**
                 * Everything else remains external because of:
                 *
                 *   packages: "external"
                 */
                return undefined;
            },
        );
    },
};

/**
 * --------------------------------------------------------------------------
 * Build
 * --------------------------------------------------------------------------
 */

mkdirSync(
    "./dist",
    {
        recursive: true,
    },
);

const result = await Bun.build({
    entrypoints,
    outdir: "./dist",

    target: "node",
    format: "esm",

    /**
     * Bundle local project files.
     * Externalize npm packages by default.
     */
    packages: "external",

    plugins: [
        bundleTs6Island,
    ],

    sourcemap: "linked",

    metafile: true,
});

if (!result.success) {
    console.error("Build failed:");

    for (const log of result.logs) {
        console.error(log);
    }

    process.exit(1);
}

/**
 * --------------------------------------------------------------------------
 * Verify TypeScript imports
 * --------------------------------------------------------------------------
 *
 * Use Bun's metafile instead of scanning the generated JS.
 *
 * We want ZERO external imports matching:
 *
 *   typescript
 *   typescript/*
 */
if (!result.metafile) {
    throw new Error(
        "Bun did not produce a metafile.",
    );
}

const externalTypescriptImports: Array<{
    input: string;
    imported: string;
}> = [];

for (
    const [
        inputPath,
        input,
    ] of Object.entries(
        result.metafile.inputs,
    )
) {
    for (
        const dependency of input.imports
    ) {
        if (
            /^typescript(?:\/.*)?$/.test(
                dependency.path,
            ) &&
            dependency.external === true
        ) {
            externalTypescriptImports.push({
                input: inputPath,
                imported: dependency.path,
            });
        }
    }
}

if (
    externalTypescriptImports.length > 0
) {
    console.error(
        [
            "",
            "BUILD VERIFICATION FAILED",
            "",
            "TypeScript imports are still external:",
            "",
            ...externalTypescriptImports.map(
                ({
                    input,
                    imported,
                }) =>
                    `  ${input} -> ${imported}`,
            ),
            "",
            "The ESLint toolchain could therefore resolve",
            "the consuming application's TypeScript 7.",
        ].join("\n"),
    );

    process.exit(1);
}

/**
 * --------------------------------------------------------------------------
 * Verify TS6 is actually present in the bundle
 * --------------------------------------------------------------------------
 */

const bundledTypescriptInputs =
    Object.keys(
        result.metafile.inputs,
    ).filter(
        (inputPath) => {
            return (
                inputPath.includes(
                    typescript6Root,
                ) ||
                inputPath.includes(
                    "/typescript@6.",
                )
            );
        },
    );

if (
    bundledTypescriptInputs.length === 0
) {
    console.error(
        [
            "",
            "BUILD VERIFICATION FAILED",
            "",
            "No TypeScript 6 files were found in the bundle.",
            "",
            `Expected TS6 root: ${typescript6Root}`,
        ].join("\n"),
    );

    process.exit(1);
}

console.log("");
console.log(
    `Verified: ${bundledTypescriptInputs.length} TypeScript 6 inputs are bundled.`,
);

console.log(
    "Verified: no TypeScript runtime imports remain external.",
);

/**
 * --------------------------------------------------------------------------
 * Output
 * --------------------------------------------------------------------------
 */

console.log("");
console.log("Build succeeded:");
console.log("");

for (
    const output of result.outputs
) {
    console.log(`  ${output.path}`);
}

console.log("");
console.log(
    `TypeScript ${typescript6PackageJson.version} is embedded in the ESLint configs.`,
);