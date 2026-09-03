import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// The SSR lib (RenderModule) proxies /@vite/ requests to this dev server in
// development — port/config live HERE so `bun run dev:vite` stays flag-free.
export default defineConfig(({ isSsrBuild }) => ({
  plugins: [react({})],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
    dedupe: ['react', 'react-dom', '@nestjs-ssr/react'],
  },
  ssr: {
    // @repo/ui, lucide-react, sonner etc are workspace/local deps the SSR
    // bundle must inline (vite would externalize node_modules otherwise).
    noExternal: [
      '@nestjs-ssr/react',
      '@repo/ui',
      '@tanstack/react-query',
      '@tanstack/react-form',
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
