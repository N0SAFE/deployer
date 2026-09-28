import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

/**
 * Every dev asset (the HMR client, the entry module, lazy chunks, CSS,
 * dependency pre-bundles) is served under this single prefix.
 *
 * WHY A PREFIX AT ALL: the SSR views are served by the API, and the API sits
 * behind a gateway/tunnel that only forwards a known set of paths. Vite's
 * default layout scatters assets across `/@vite/client`, `/@fs/`,
 * `/node_modules/.vite/` and `/src/...`, which means whitelisting them all.
 * One prefix makes the whole dev asset surface a single forwardable path.
 */
export const VITE_BASE = '/vite/';

/**
 * Silence the one Vite log class that is pure noise here.
 *
 * Published packages in `node_modules` ship without `.map` files, so Vite emits
 * "Failed to load source map …" plus an ENOENT stack for EVERY dependency it
 * transforms — ~44 lines per boot in this app, all unfixable from our side and
 * all meaningless. They buried the real boot logs (which is how a genuine
 * warning gets missed), so they are filtered while every other warning and
 * error still comes through.
 */
const SOURCE_MAP_NOISE = [
  /Failed to load source map for/,
  /An error occurred while trying to read the map file at/,
];

function isSourceMapNoise(args: unknown[]): boolean {
  const first = args[0];
  return typeof first === 'string' && SOURCE_MAP_NOISE.some((re) => re.test(first));
}

// The SSR lib (RenderModule) proxies Vite asset requests to this dev server in
// development — port/config live HERE so the start script stays flag-free.
export default defineConfig(({ isSsrBuild }) => ({
  // Root-absolute asset URLs under the single `/vite/` prefix.
  base: VITE_BASE,
  customLogger: {
    info: (msg) => {
      if (!isSourceMapNoise([msg])) console.log(msg);
    },
    warn: (msg, options) => {
      if (!isSourceMapNoise([msg])) console.warn(msg, options ?? '');
    },
    warnOnce: (msg, options) => {
      if (!isSourceMapNoise([msg])) console.warn(msg, options ?? '');
    },
    error: (msg, options) => {
      // Errors are NEVER filtered: a suppressed error is how a real failure
      // becomes invisible.
      console.error(msg, options ?? '');
    },
    clearScreen: () => {
      /* no-op: keep the surrounding server logs on screen */
    },
    hasWarned: false,
  },
  plugins: [
    // Tailwind v4 is compiled by the BUNDLER, not by PostCSS — the integration
    // the framework documents for Vite, and the same model apps/web uses
    // (Turbopack compiles Tailwind natively there; see apps/web/next.config.ts).
    //
    // Without this plugin Vite only INLINES `@import "tailwindcss"`: the theme
    // tokens arrive, but not one utility class is generated, so every
    // `className` in the API-served views renders as unstyled markup.
    tailwindcss(),
    react({}),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    // Dedupe is REQUIRED, not an optimisation: this is a monorepo whose
    // workspace packages (e.g. @repo/orpc-utils) carry their own nested
    // react-query. Without dedupe the SSR bundle gets TWO react-query
    // instances, so a component reading a provider set by the other instance
    // throws "No QueryClient set" — which is exactly how the setup wizard
    // failed to render.
    dedupe: [
      'react',
      'react-dom',
      '@nestjs-ssr/react',
      '@tanstack/react-query',
      '@tanstack/react-form',
      '@orpc/client',
      '@orpc/tanstack-query',
    ],
  },
  ssr: {
    // @repo/ui, lucide-react, sonner etc are workspace/local deps the SSR
    // bundle must inline (vite would externalize node_modules otherwise).
    noExternal: [
      '@nestjs-ssr/react',
      '@repo/ui',
      // Workspace ORPC helpers must be inlined too: loaded externally, they
      // resolve their OWN @tanstack/react-query (see the dedupe note above).
      '@repo/orpc-utils',
      '@repo/api-contracts',
      '@repo/contracts-entities',
      '@repo/errors',
      '@tanstack/react-query',
      '@tanstack/react-form',
      'next-themes',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'class-variance-authority',
      'radix-ui',
      'tw-animate-css',
    ],
  },
  server: {
    // Bind IPv4 loopback EXPLICITLY. Vite's default `localhost` resolves to
    // `::1` inside this container, so the server listened on IPv6 ONLY and
    // every IPv4 consumer (the SSR library's own proxy, and this app's
    // `/vite` forwarding) got ECONNREFUSED → 503. `127.0.0.1` is the address
    // the proxies actually dial, so bind that.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: { port: 5173 },
  },
  build: {
    outDir: isSsrBuild ? 'dist/api/server' : 'dist/api/client',
    manifest: true,
    rollupOptions: {
      input: !isSsrBuild
        ? {
            client: resolve(__dirname, 'src/views/entry-client.tsx'),
          }
        : undefined,
      external: (id: string) => {
        if (id.includes('/fsevents') || id.endsWith('fsevents')) {
          return true;
        }
        if (id.endsWith('.node')) {
          return true;
        }
        return false;
      },
    },
  },
}));
