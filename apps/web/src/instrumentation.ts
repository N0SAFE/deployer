/**
 * Next.js instrumentation hook — runs ONCE at server startup, in the
 * SERVER bundle only. Never imported by client code, so it is the one safe
 * place to wire server-only modules into shared singletons.
 *
 * Registers the app-instance token provider used by AppInstancePlugin
 * (lib/orpc/plugins/app-instance-plugin.ts). The plugin cannot import
 * lib/platform/app-instance.server itself — not even dynamically — because
 * Turbopack includes dynamically-imported modules in client chunks too,
 * where "server-only" throws.
 *
 * See: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
    // Next.js compiles instrumentation.ts for BOTH the Node.js and Edge
    // runtimes. The identity module uses Bun file APIs (Bun.file/Bun.write)
    // which only exist where `next` runs under `bun --bun` — i.e. the
    // Node.js server runtime. Gate on NEXT_RUNTIME so the dynamic import is
    // tree-shaken out of the Edge graph entirely (otherwise the build emits
    // "Node.js module not supported in Edge Runtime" errors for it).
    if (process.env.NEXT_RUNTIME !== "nodejs") {
        return;
    }
    const { registerAppInstanceTokenProvider } = await import(
        "@/lib/orpc/plugins/app-instance-plugin"
    );
    const { getAppInstanceToken } = await import(
        "@/lib/platform/app-instance.server"
    );

    registerAppInstanceTokenProvider(getAppInstanceToken);
}
