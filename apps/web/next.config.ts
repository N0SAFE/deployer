import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";
import { envSchema } from "./env";
import { readFileSync } from "fs";
import path from "node:path";

// When this file is loaded as a CJS module by Next.js, `__dirname` is the
// directory of this config file (apps/web/). Going up two levels reaches the
// monorepo root where `next` is hoisted in node_modules.
// NOTE: do NOT use `import.meta.url` here — Bun 1.3.14 has a transpiler bug
// that throws "Expected CommonJS module to have a function wrapper" when
// `import.meta.url` is used inside a `.ts` file loaded as CJS.

type PackageJsonShape = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function getWorkspaceTranspilePackages(): string[] {
  try {
    const packageJson = JSON.parse(
      readFileSync("./package.json", "utf-8"),
    ) as PackageJsonShape;

    const allDeps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
      ...(packageJson.optionalDependencies ?? {}),
      ...(packageJson.peerDependencies ?? {}),
    };

    return Object.keys(allDeps)
      .filter((dep) => dep.startsWith("@repo/"))
      .sort();
  } catch (error) {
    console.warn(
      "Failed to auto-resolve workspace transpile packages, using fallback list:",
      error,
    );
    return ["@repo/declarative-routing", "@repo/nextjs-devtool"];
  }
}

const workspaceTranspilePackages = getWorkspaceTranspilePackages();

console.log(workspaceTranspilePackages)

// Check if we're running in a lint context or other non-build contexts
const commandLine = process.argv.join(" ");
const isLintContext =
  process.argv.includes("lint") ||
  process.argv.some((arg) => arg.includes("eslint")) ||
  process.env.npm_lifecycle_event === "lint" ||
  process.env.npm_lifecycle_script?.includes("lint") ||
  process.argv.some((arg) => arg.includes("next-lint")) ||
  commandLine.endsWith("lint");
  
  const isCompileContext = 
  process.env.COMPILE_MODE === "true" ||
  process.argv.includes("--experimental-build-mode=compile") ||
  process.argv.includes("--build-mode=compile") ||
  process.env.npm_lifecycle_event === "compile" ||
  process.env.npm_lifecycle_script?.includes("compile");

if (!process.env.API_URL) {
  if (isLintContext || isCompileContext) {
    // Provide a default URL for linting context to avoid breaking the lint process
    process.env.API_URL = "http://localhost:3001";
    console.warn(
      "API_URL not defined, using default for lint context:",
      process.env.API_URL,
    );
  } else {
    throw new Error("API_URL is not defined");
  }
}

// Handle both full URLs and hostname-only values (for Render deployment)
const apiUrl = new URL(envSchema.shape.API_URL.parse(process.env.API_URL));

const noCheck = process.env.CHECK_ON_BUILD !== "true";

const nextConfig: NextConfig = {
  serverExternalPackages: ["esbuild-wasm"],
  async rewrites() {
    return [
      {
        source: "/api/auth/:path*",
        destination: `${apiUrl.href}/api/auth/:path*`,
      },
      {
        source: "/api/nest/:path*",
        destination: `${apiUrl.href}/:path*`,
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: noCheck,
    // compilerOptions: {
    //   experimentalDecorators: true,
    //   useDefineForClassFields: true,
    // },
  },
  reactStrictMode: true,
  // Auto-detected from this app's package.json (@repo/* deps)
  // so adding/removing workspace deps keeps transpilation in sync.
  transpilePackages: [
    ...workspaceTranspilePackages,
    // Workaround for Turbopack bug: @xyflow/react + framer-motion causes
    // `evaluate_webpack_loader` panic in Next.js 16.2.x. Transpiling these
    // packages through the Turbopack transformer (instead of going through
    // the webpack-loader fallback) avoids the crash. See:
    // https://github.com/vercel/next.js/issues/93144
    "@xyflow/react",
    "@xyflow/system",
    "framer-motion",
    "motion",
    "motion-dom",
    "motion-utils",
  ],
  cacheComponents: true,
  reactCompiler: false,
  // Monorepo: tell Turbopack the workspace root so it can resolve `next` from
  // the hoisted `node_modules` at the repo root. Without this, Next.js 16+ with
  // Turbopack errors with "could not find next/package.json" in Docker
  // (project dir: /app/apps/web/src/app, but `next` is hoisted at /app/node_modules).
  turbopack: {
    root: path.join(__dirname, "../.."),
    // Workaround for Turbopack bug #93144: @xyflow/react has
    // `sideEffects: ["*.css"]` which causes Turbopack to auto-include the
    // package's CSS files. These go through the webpack-loader fallback
    // (PostCSS) and fail with "invalid type: null, expected a string".
    // We mark only the xyflow package's CSS files as `raw` type to avoid
    // breaking Tailwind v4 processing for our own CSS files.
    rules: {
      "**/@xyflow/react/dist/base.css": { type: "raw" },
      "**/@xyflow/react/dist/style.css": { type: "raw" },
      "**/node_modules/@xyflow/react/**/*.css": { type: "raw" },
      "**/node_modules/.bun/**/@xyflow/react/**/*.css": { type: "raw" },
    },
  },
  images: {
    dangerouslyAllowSVG: true,
    remotePatterns: [
      {
        hostname: apiUrl.hostname,
        port: apiUrl.port,
        protocol: apiUrl.protocol.replace(":", "") as "http" | "https",
      },
      {
        hostname: "avatars.githubusercontent.com",
        protocol: "https",
      },
    ],
  },

  // postcss.config.mjs is intentionally disabled — Turbopack handles Tailwind v4
  // natively via Lightning CSS. The CSS imports for tw-animate-css and shadcn
  // are resolved via local copies in src/assets/css/ (relative @import paths),
  // because Turbopack's CSS resolver does not support the "style" condition in
  // package.json exports that these packages use.

  // Webpack config is conditionally included only for non-Turbopack runs.
  // When `next dev --turbopack` is used, we omit the webpack function entirely
  // to avoid a Next.js 16.2.9 Turbopack bug: PostCssTransformedAsset -> evaluate_webpack_loader crash.
  // This keeps Turbopack handling CSS via Lightning CSS without webpack loader fallback.
  ...(process.env.WEBPACK
    ? {
        webpack: (config: any, context: any) => {
    // Prevent webpack from watching dist/ directories inside @repo packages
    // to avoid recompile loops when package builds write to dist/
    config.watchOptions ??= {};
    if (Array.isArray(config.watchOptions.ignored)) {
      config.watchOptions.ignored.push("**/dist/**");
    } else if (typeof config.watchOptions.ignored === "string") {
      config.watchOptions.ignored = [config.watchOptions.ignored, "**/dist/**"];
    } else {
      config.watchOptions.ignored = ["**/dist/**"];
    }

    // Enable polling based on env variable being set
    if (process.env.NEXT_WEBPACK_USEPOLLING) {
      config.watchOptions = {
        ...config.watchOptions,
        poll: 500,
        aggregateTimeout: 300,
      };
    } 

    // ── Compilation Loop Debug Plugin ──────────────────────────────
    // Enabled when NEXT_DEBUG_COMPILE=1 is set in environment.
    // Logs every watch-triggered recompilation, which files changed,
    // compilation duration, and detects potential loops.
    // ───────────────────────────────────────────────────────────────
    if (process.env.NEXT_DEBUG_COMPILE === "1") {
      let compileCount = 0;
      let lastModifiedFiles: string[] = [];

      config.plugins.push({
        apply: (compiler: any) => {
          // ── File change detected (earliest hook) ──
          compiler.hooks.invalid.tap(
            "CompileLoopDebugPlugin",
            (fileName: string, changeTime: number) => {
              console.log(
                `[DEBUG:WATCH] File invalidated at ${new Date(changeTime).toISOString()}: ${fileName}`,
              );
            },
          );

          // ── Watch-triggered compilation starting ──
          compiler.hooks.watchRun.tapAsync(
            "CompileLoopDebugPlugin",
            (comp: any, callback: any) => {
              compileCount++;
              const modifiedFiles: string[] = comp.modifiedFiles
                ? Array.from(comp.modifiedFiles)
                : [];
              const removedFiles: string[] = comp.removedFiles
                ? Array.from(comp.removedFiles)
                : [];

              console.log(
                `\n=== [DEBUG:COMPILE #${compileCount}] ==========================`,
              );
              console.log(
                `  Triggered by ${modifiedFiles.length} change(s)` +
                  (removedFiles.length > 0
                    ? ` + ${removedFiles.length} removal(s)`
                    : ""),
              );

              if (modifiedFiles.length > 0) {
                console.log(`  ── Modified files:`);
                for (const f of modifiedFiles.slice(0, 30)) {
                  console.log(`    ${f}`);
                }
                if (modifiedFiles.length > 30) {
                  console.log(`    ... and ${modifiedFiles.length - 30} more`);
                }
              }
              if (removedFiles.length > 0) {
                console.log(`  ── Removed files:`);
                for (const f of removedFiles) {
                  console.log(`    ${f}`);
                }
              }

              // Detect repeat of the same file set (loop indicator)
              if (
                lastModifiedFiles.length > 0 &&
                modifiedFiles.length > 0 &&
                modifiedFiles.length === lastModifiedFiles.length &&
                modifiedFiles.every((f: string) =>
                  lastModifiedFiles.includes(f),
                )
              ) {
                console.log(
                  `  ⚠️  SAME ${modifiedFiles.length} FILE(S) AS COMPILE #${compileCount - 1} — POSSIBLE LOOP!`,
                );
              }
              lastModifiedFiles = modifiedFiles;

              callback();
            },
          );

          // ── Compilation finished ──
          compiler.hooks.done.tap(
            "CompileLoopDebugPlugin",
            (stats: any) => {
              const duration = stats.endTime - stats.startTime;
              const hasErrors = stats.hasErrors();
              const hasWarnings = stats.hasWarnings();

              console.log(
                `=== [DEBUG:COMPILE #${compileCount}] Done — ${duration}ms` +
                  (hasErrors
                    ? " ❌ ERRORS"
                    : hasWarnings
                      ? " ⚠️ Warnings"
                      : " ✅ OK"),
              );

              if (hasErrors) {
                for (const err of stats.compilation.errors) {
                  console.log(`    Error:`, err.message || err);
                }
              }
              if (hasWarnings) {
                for (const warn of stats.compilation.warnings.slice(0, 5)) {
                  console.log(`    Warning:`, warn.message || warn);
                }
                if (stats.compilation.warnings.length > 5) {
                  console.log(
                    `    ... and ${stats.compilation.warnings.length - 5} more warnings`,
                  );
                }
              }
              console.log(``);
            },
          );

          // ── Compilation failed ──
          compiler.hooks.failed.tap(
            "CompileLoopDebugPlugin",
            (error: any) => {
              console.log(
                `[DEBUG:FAIL] Compilation #${compileCount} failed:`,
                error?.message || error,
              );
            },
          );

          // ── needAdditionalPass = webpack wants to loop (strong signal) ──
          compiler.hooks.compilation.tap(
            "CompileLoopDebugPlugin",
            (compilation: any) => {
              compilation.hooks.needAdditionalPass.tap(
                "CompileLoopDebugPlugin",
                () => {
                  console.log(
                    `  🔄 [DEBUG:LOOP] needAdditionalPass fired after compile #${compileCount}! Webpack requested another pass.`,
                  );
                  // Return undefined to NOT block the additional pass
                },
              );
            },
          );
        },
      });
    }
    // ── End Debug Plugin ──────────────────────────────────────────

    return config;
        },
      }
    : {}),
};

// Enable MDX and Fumadocs source generation
let exp: NextConfig = nextConfig;

if (process.env.ANALYZE === "true") {
  exp = withBundleAnalyzer()(exp);
}

export default exp;
