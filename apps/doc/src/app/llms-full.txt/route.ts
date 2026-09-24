import { getLLMText, source } from '@/lib/source';

/**
 * Static export: `next build` runs this once and writes the result to
 * `out/llms-full.txt`. `dynamic = 'force-static'` is what makes the export
 * emit a file instead of demanding a server at request time.
 */
export const dynamic = 'force-static';

export async function GET() {
  const scanned = await Promise.all(source.getPages().map(getLLMText));

  return new Response(scanned.join('\n\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
