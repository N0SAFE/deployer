import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';

/**
 * Every dev asset (the HMR client, the entry module, lazy chunks, CSS,
 * dependency pre-bundles) is served under this single prefix.
 *
 * WHY A PREFIX AT ALL: the wizard is served by the setup app, which sits behind
 * Traefik and is reachable only through it. Vite's default layout scatters
 * assets across `/@vite/client`, `/@fs/`, `/node_modules/.vite/` and `/src/...`,
 * which means whitelisting them all. One prefix makes the whole dev asset
 * surface a single forwardable path — the same reason apps/api does it.
 */
export const VITE_BASE = '/vite/';

/**
 * Silence the one Vite log class that is pure noise here.
 *
 * Published packages in `node_modules` ship without `.map` files, so Vite emits
 * "Failed to load source map …" plus an ENOENT stack for EVERY dependency it
 * transforms. All of it is unfixable from our side and meaningless, and it
 * buries the real boot logs — so it is filtered while every other warning and
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
//
// PORT 5174, not the API's 5173: in dev BOTH apps run at once (setup drives the
// API), so they must not contend for the dev asset server. `strictPort` makes a
// collision a loud failure rather than a silent fallback to another port that
// the RenderModule proxy would then not know about.
export default defineConfig(({ isSsrBuild }) => ({
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
    // `className` in the wizard renders as unstyled markup.
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
    // `::1` inside the container, so the server listened on IPv6 ONLY and every
    // IPv4 consumer (the SSR library's own proxy) got ECONNREFUSED → 503.
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    hmr: { port: 5174 },
  },
  build: {
    outDir: isSsrBuild ? 'dist/setup/server' : 'dist/setup/client',
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
